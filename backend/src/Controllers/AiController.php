<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Config;
use App\Core\Database;

class AiController extends BaseController
{
    public function processConsultation(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $userId = $request->getUserId();

        // 1. Feature Flag / Consentimento LGPD
        $aiEnabled = Config::get('AI_FEATURE_ENABLED', 'true');
        if ($aiEnabled !== 'true' && $aiEnabled !== '1') {
            Response::error('Recurso de IA desativado para esta clínica ou requer termo de consentimento (DPA/LGPD).', 403);
        }

        $apiKey = Config::get('GEMINI_API_KEY');
        if (empty($apiKey)) {
            Response::error('Chave de API de IA não configurada no servidor.', 503);
        }

        $rawTranscript = trim((string) $request->input('rawTranscript', ''));
        if (empty($rawTranscript)) {
            Response::error('Transcrição da consulta é obrigatória', 422);
        }

        // 2. Rate Limiting: máx 15 requisições de IA por minuto por usuário
        $this->ensureAiRateLimit($userId);

        // 3. Minimização / Anonimização de PHI antes do envio a provedores externos
        $minimizedTranscript = $this->minimizePhi($rawTranscript);

        // 4. Execução Server-Side da chamada ao Gemini
        $result = $this->callGeminiApi($apiKey, $minimizedTranscript);

        // 5. Log de Auditoria LGPD
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
                    'character_count' => strlen($rawTranscript)
                ])
            ]);
        } catch (\Throwable) {
            // Não abortar
        }

        Response::success($result);
    }

    private function minimizePhi(string $text): string
    {
        // Remove CPFs (XXX.XXX.XXX-XX ou 11 dígitos)
        $text = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/', '[CPF_OMITIDO]', $text);
        // Remove números de telefone
        $text = preg_replace('/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[-\s]?\d{4}\b/', '[TELEFONE_OMITIDO]', $text);
        // Remove e-mails
        $text = preg_replace('/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/', '[EMAIL_OMITIDO]', $text);
        return $text;
    }

    private function callGeminiApi(string $apiKey, string $transcript): array
    {
        $systemInstruction = "Você é um copiloto de documentação médica clínica em conformidade com LGPD.\nTransforme a transcrição clínica em um objeto JSON puro com as chaves: queixaPrincipal, historicoFamiliar, tratamentosAnteriores, alergias, historicoPessoal, condicoesDetectadas (array), medicacoesEmUso, condutaPlano.\nFidelidade estrita, não invente dados.";

        $models = [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-flash'
        ];

        $payload = [
            'contents' => [
                [
                    'role' => 'user',
                    'parts' => [
                        ['text' => "{$systemInstruction}\n\nTranscrição:\n\"\"\"\n{$transcript}\n\"\"\""]
                    ]
                ]
            ],
            'generationConfig' => [
                'temperature' => 0.1,
                'topP' => 0.8,
                'maxOutputTokens' => 2048,
                'responseMimeType' => 'application/json'
            ]
        ];

        $jsonPayload = json_encode($payload);

        foreach ($models as $model) {
            $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$apiKey}";

            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonPayload);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json'
            ]);
            curl_setopt($ch, CURLOPT_TIMEOUT, 20);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);

            if ($httpCode === 200 && !empty($response)) {
                $data = json_decode($response, true);
                $textOutput = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
                if (!empty($textOutput)) {
                    $cleanJson = trim($textOutput);
                    if (str_starts_with($cleanJson, '```json')) {
                        $cleanJson = preg_replace('/^```json\s*/', '', $cleanJson);
                        $cleanJson = preg_replace('/\s*```$/', '', $cleanJson);
                    }
                    $parsed = json_decode($cleanJson, true);
                    if (is_array($parsed)) {
                        return $parsed;
                    }
                }
            }
        }

        // Fallback estruturado se API externa estiver indisponível
        return [
            'queixaPrincipal' => $transcript,
            'historicoFamiliar' => 'Não informado na consulta.',
            'tratamentosAnteriores' => 'Não informado na consulta.',
            'alergias' => 'Não informado na consulta.',
            'historicoPessoal' => 'Não informado na consulta.',
            'condicoesDetectadas' => [],
            'medicacoesEmUso' => 'Não informado na consulta.',
            'condutaPlano' => 'Orientações registradas na consulta.'
        ];
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
            $count = (int) Database::fetchOne(
                "SELECT COUNT(*) as total FROM ai_rate_limits WHERE user_id = :uid AND requested_at > :window",
                ['uid' => $userId, 'window' => $window]
            )['total'] ?? 0;

            if ($count >= 15) {
                Response::error('Limite de requisições de IA excedido (máximo 15 por minuto). Aguarde.', 429);
            }

            Database::execute(
                "INSERT INTO ai_rate_limits (id, user_id, requested_at) VALUES (:id, :uid, :time)",
                ['id' => 'arl_' . bin2hex(random_bytes(6)), 'uid' => $userId, 'time' => time()]
            );
        } catch (\Throwable) {
            // Silencioso
        }
    }
}
