import { PageHeader } from "@/components/ui";
import { Preview } from "./preview";

export const metadata = { title: "Prévia visual" };

export default function PreviewPage() {
  return (
    <>
      <PageHeader
        title="Prévia visual"
        subtitle="Dados fictícios, só para aprovar o visual. Funciona em celular e computador, claro e escuro."
      />
      <Preview />
    </>
  );
}
