<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Config;
use App\Core\Database;

/**
 * Proxy legado do copiloto de prontuário (o frontend em produção usa a função server-side
 * src/services/ai.service.ts). Mantido com as mesmas garantias: TLS verificado, chave fora
 * da URL, identificadores removidos e nenhum texto clínico gerado quando a IA falha.
 */
class AiController extends BaseController
{
    private const MODEL_DEFAULT = 'gemini-2.5-flash';

    public function processConsultation(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $userId = (string) $request->getUserId();

        $aiEnabled = Config::get('AI_FEATURE_ENABLED', 'true');
        if ($aiEnabled !== 'true' && $aiEnabled !== '1') {
            Response::error('Recurso de IA desativado para esta clínica ou pendente de termo de consentimento (DPA/LGPD).', 403);
        }

        $apiKey = Config::get('GEMINI_API_KEY');
        if (empty($apiKey)) {
            Response::error('Chave de API de IA não configurada no servidor.', 503);
        }

        $rawTranscript = trim((string) $request->input('rawTranscript', ''));
        if ($rawTranscript === '') {
            Response::error('Transcrição da consulta é obrigatória', 422);
        }
        if (mb_strlen($rawTranscript) > 20000) {
            Response::error('Transcrição muito longa (máximo de 20.000 caracteres).', 422);
        }

        $this->ensureAiRateLimit($userId);

        $patientName = trim((string) $request->input('patientName', ''));
        $minimizedTranscript = $this->minimizePhi($rawTranscript, $patientName);
        $result = $this->callGeminiApi((string) $apiKey, $minimizedTranscript);

        try {
            Database::execute("
                INSERT INTO activity_logs (id, company_id, user_id, entity_type, entity_id, entity_label, action, metadata)
                VALUES (:id, :cid, :uid, 'ai_copilot', :eid, 'Estruturacao de Prontuario IA', 'generate', :meta)
            ", [
                'id' => 'act_' . substr(bin2hex(random_bytes(6)), 0, 12),
                'cid' => $companyId,
                'uid' => $userId,
                'eid' => 'copilot_' . substr(bin2hex(random_bytes(4)), 0, 8),
                'meta' => json_encode([
                    'status' => 'success',
                    'timestamp' => date('Y-m-d H:i:s'),
                    'character_count' => mb_strlen($rawTranscript),
                ]),
            ]);
        } catch (\Throwable) {
            // A auditoria não interrompe a resposta.
        }

        Response::success($result);
    }

    /** Remove identificadores diretos (nome, CPF, telefone, e-mail) antes do envio ao provedor externo. */
    private function minimizePhi(string $text, string $patientName): string
    {
        $text = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/', '[CPF]', $text);
        $text = preg_replace('/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/iu', '[EMAIL]', $text);
        $text = preg_replace('/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/', '[TELEFONE]', $text);

        foreach (preg_split('/\s+/u', $patientName) ?: [] as $part) {
            if (mb_strlen($part) >= 3) {
                $text = preg_replace('/\b' . preg_quote($part, '/') . '\b/iu', '[PACIENTE]', $text);
            }
        }

        return (string) $text;
    }

    private function callGeminiApi(string $apiKey, string $transcript): array
    {
        $instruction = 'Você é um copiloto de documentação clínica em conformidade com a LGPD. '
            . 'Transforme a transcrição em um objeto JSON com as chaves: queixaPrincipal, historicoFamiliar, '
            . 'tratamentosAnteriores, alergias, historicoPessoal, condicoesDetectadas (array), medicacoesEmUso, condutaPlano. '
            . 'Use somente o que foi dito. Quando algo não foi mencionado, use null. Nunca invente dados.';

        $payload = json_encode([
            'contents' => [[
                'role' => 'user',
                'parts' => [['text' => "{$instruction}\n\nTranscrição:\n\"\"\"\n{$transcript}\n\"\"\""]],
            ]],
            'generationConfig' => [
                'temperature' => 0.1,
                'maxOutputTokens' => 2048,
                'responseMimeType' => 'application/json',
            ],
        ], JSON_UNESCAPED_UNICODE);

        $model = (string) (Config::get('GEMINI_MODEL') ?: self::MODEL_DEFAULT);
        $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $apiKey],
            CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $caBundle = ini_get('curl.cainfo') ?: ini_get('openssl.cafile');
        if (!empty($caBundle) && file_exists($caBundle)) {
            curl_setopt($ch, CURLOPT_CAINFO, $caBundle);
        }

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($response === false || $httpCode !== 200) {
            error_log(sprintf('[AI_PROXY] Falha na chamada ao Gemini: HTTP %d %s', $httpCode, $curlError));
            Response::error('O serviço de IA não respondeu. Tente novamente em instantes.', 502);
        }

        $data = json_decode((string) $response, true);
        $text = trim((string) ($data['candidates'][0]['content']['parts'][0]['text'] ?? ''));
        $text = preg_replace('/^```(?:json)?\s*|\s*```$/', '', $text);
        $parsed = json_decode((string) $text, true);

        if (!is_array($parsed)) {
            Response::error('A IA devolveu uma resposta em formato inesperado. Tente novamente.', 502);
        }

        return $parsed;
    }

    private function ensureAiRateLimit(string $userId): void
    {
        try {
            Database::execute("
                CREATE TABLE IF NOT EXISTS ai_rate_limits (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    requested_at INTEGER NOT NULL
                )
            ");
            $window = time() - 60;
            $count = (int) (Database::fetchOne(
                "SELECT COUNT(*) as total FROM ai_rate_limits WHERE user_id = :uid AND requested_at > :window",
                ['uid' => $userId, 'window' => $window]
            )['total'] ?? 0);

            if ($count >= 15) {
                Response::error('Limite de requisições de IA excedido (máximo 15 por minuto). Aguarde.', 429);
            }

            Database::execute(
                "INSERT INTO ai_rate_limits (id, user_id, requested_at) VALUES (:id, :uid, :time)",
                ['id' => 'arl_' . bin2hex(random_bytes(6)), 'uid' => $userId, 'time' => time()]
            );
        } catch (\Throwable) {
            // Sem armazenamento do limite, a chamada segue (o provedor também limita).
        }
    }
}
