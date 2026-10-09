import { createFileRoute, notFound } from "@tanstack/react-router";
import { AuthScreen, validateAuthSearch } from "@/routes/auth";
import { fetchLoginBranding } from "@/features/branding/login-branding";

/**
 * Login com a identidade visual de um cliente: meedcore.vercel.app/<slug>.
 * O slug, a logo e as cores são cadastrados na aba Clientes da administração.
 */
export const Route = createFileRoute("/$clinica")({
  validateSearch: validateAuthSearch,
  loader: async ({ params }) => {
    const slug = params.clinica.toLowerCase();
    if (!/^[a-z0-9-]{3,50}$/.test(slug)) throw notFound();
    const branding = await fetchLoginBranding(slug).catch(() => null);
    if (!branding) throw notFound();
    return { branding };
  },
  head: ({ loaderData }) => {
    const name = loaderData?.branding.name ?? "MedCore";
    return {
      meta: [
        { title: `Acesse sua conta • ${name} • MedCore` },
        { name: "description", content: `Acesso ao sistema da ${name}.` },
        { property: "og:title", content: name },
        { property: "og:site_name", content: name },
        ...(loaderData?.branding.logoUrl
          ? [{ property: "og:image", content: loaderData.branding.logoUrl }]
          : []),
      ],
    };
  },
  component: ClinicLoginPage,
});

function ClinicLoginPage() {
  const { branding } = Route.useLoaderData();
  const search = Route.useSearch();
  return <AuthScreen search={search} branding={branding} />;
}
