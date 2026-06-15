"use client";

import { icons, type LucideProps } from "lucide-react";

// Convert the prototype's kebab-case icon names (e.g. "brain-circuit") to the
// PascalCase keys lucide-react uses (e.g. "BrainCircuit").
function toPascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

type IconProps = LucideProps & { name: string };

// NOTE: imports the full lucide `icons` map for convenience while we build many
// screens. Before the production build we can swap this for an explicit
// allowlist to trim the client bundle.
export function Icon({ name, size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
  const Cmp = icons[toPascal(name) as keyof typeof icons];
  if (!Cmp) return null;
  return <Cmp size={size} strokeWidth={strokeWidth} {...rest} />;
}
