"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

export function PersonFilter({
  people,
  value,
  period,
}: {
  people: { id: string; name: string }[];
  value: string;
  period: string;
}) {
  const router = useRouter();
  return (
    <Select
      aria-label="Pessoa"
      value={value}
      className="w-48"
      onChange={(e) => {
        const p = new URLSearchParams({ p: period });
        if (e.target.value) p.set("pessoa", e.target.value);
        router.push(`/?${p.toString()}`);
      }}
    >
      <option value="">Toda a empresa</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
