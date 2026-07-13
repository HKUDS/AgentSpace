import type { ActiveEmployee } from "./workspace.ts";

/**
 * Map an AgentSpace Digital Employee onto an OpenAgent persona-card. OpenAgent
 * (spec at github.com/5dive-ai/openagent) is an identity/persona layer: it
 * describes who an agent IS (name, role, face, voice, behavior) and can carry a
 * self-verifying ed25519 provenance block. AgentSpace already models the "who"
 * as an ActiveEmployee, so the two compose.
 *
 * This module is the PURE, runtime-agnostic half: the persona TYPES and the
 * `employeeToPersona()` mapper. It has no Node dependency (no node:crypto, no
 * Buffer) so it type-checks under the domain package's runtime-agnostic build.
 * Signing (ed25519 provenance + did:key derivation) lives in a Node layer that
 * composes on top of this mapper — see apps/cli's openagent-persona-sign.
 *
 * PRIVACY: by default the mapper REDACTS the employee's operator instructions,
 * resolved skills, and owner identity — a persona-card is a shareable identity
 * artifact, not an export of the operator's private configuration. Callers pass
 * `includeSensitive: true` to opt those fields back in.
 */

export interface OpenAgentPersonaOrg {
  name: string;
  url?: string;
}

export interface OpenAgentPersonaFaceRecipe {
  provider?: string;
  model: string;
  prompt: string;
  seed?: number | string;
}

export interface OpenAgentPersonaFace {
  ref: string;
  anchor: string;
  recipe?: OpenAgentPersonaFaceRecipe;
}

export interface OpenAgentPersonaVoiceWritten {
  rules: string[];
  sample: string;
}

export interface OpenAgentPersonaVoice {
  written?: OpenAgentPersonaVoiceWritten;
}

export interface OpenAgentPersonaProvenanceAuthor {
  name?: string;
  key: string;
  url?: string;
}

export interface OpenAgentPersonaProvenance {
  created_by: OpenAgentPersonaProvenanceAuthor;
  signed_at: string;
  signature?: string;
}

export interface OpenAgentPersona {
  openagent: string;
  id: string;
  name: string;
  role: string;
  org?: OpenAgentPersonaOrg;
  behavior: string;
  posts_about?: string[];
  face: OpenAgentPersonaFace;
  voice: OpenAgentPersonaVoice;
  provenance?: OpenAgentPersonaProvenance;
}

export interface PersonaMappingOptions {
  /**
   * Include the employee's sensitive fields — operator instructions, resolved
   * skills, and owner identity — in the persona. Defaults to false: these are
   * redacted so a shared card never leaks private operator configuration.
   */
  includeSensitive?: boolean;
}

// ---- id slug ---------------------------------------------------------------

/** Slugify a display name to the persona `id` pattern ^[a-z0-9-]+$. */
export function slugifyPersonaId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

// ---- deterministic anchor colour -------------------------------------------

// A stable 6-hex-digit accent derived from the name — the card's anchor colour.
// FNV-1a keeps it dependency-free and reproducible across runs.
function anchorColor(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
  return `#${hex}`;
}

// ---- mapping ----------------------------------------------------------------

function personaRole(employee: ActiveEmployee): string {
  const remark = employee.remarkName?.trim();
  return remark ? `${employee.role} (${remark})` : employee.role;
}

function personaBehavior(employee: ActiveEmployee, instructions: string | undefined): string {
  // summary is the primary "who they are"; instructions refine how they operate
  // and are only present when sensitive fields are opted in. `fit` is a readiness
  // note, not behavior — appending it produced dangling fragments, so it is left out.
  const parts = [employee.summary, instructions]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(" ") || `${employee.name}, ${employee.role}.`;
}

function voiceRules(
  employee: ActiveEmployee,
  skills: string[],
  instructions: string | undefined,
): string[] {
  const rules: string[] = [];
  if (employee.traits.length > 0) {
    rules.push(`Embodies: ${employee.traits.join(", ")}.`);
  }
  if (skills.length > 0) {
    rules.push(`Draws on skills: ${skills.join(", ")}.`);
  }
  if (instructions?.trim()) {
    rules.push(instructions.trim());
  }
  if (rules.length === 0) {
    rules.push(`Speaks as ${employee.role}.`);
  }
  return rules;
}

function facePrompt(employee: ActiveEmployee): string {
  const descriptors = employee.traits.length > 0 ? `, ${employee.traits.join(", ")}` : "";
  return `Portrait avatar of ${employee.name}, a ${employee.role}${descriptors}. Clean, friendly, professional character illustration.`;
}

/**
 * Map an ActiveEmployee onto an OpenAgent persona-card. Pure and deterministic.
 * By default the employee's instructions, skills, and owner identity are redacted;
 * pass `opts.includeSensitive` to include them. The result is UNSIGNED — attach a
 * provenance block with the Node-layer signer (apps/cli's signPersona).
 */
export function employeeToPersona(
  employee: ActiveEmployee,
  skills: string[],
  opts: PersonaMappingOptions = {},
): OpenAgentPersona {
  const includeSensitive = opts.includeSensitive ?? false;
  // Redaction is applied by gating the sensitive INPUTS, so the mapping helpers
  // below stay purely presentational and never see redacted data.
  const exposedSkills = includeSensitive ? skills : [];
  const exposedInstructions = includeSensitive ? employee.instructions : undefined;
  const exposedOwner = includeSensitive ? employee.ownerUserId : undefined;

  const id = slugifyPersonaId(employee.name);
  const postsAbout = Array.from(new Set([...employee.traits, ...exposedSkills])).filter(Boolean);

  const persona: OpenAgentPersona = {
    openagent: "0.2",
    id,
    name: employee.name,
    role: personaRole(employee),
    org: { name: exposedOwner ? `AgentSpace (${exposedOwner})` : "AgentSpace" },
    behavior: personaBehavior(employee, exposedInstructions),
    face: {
      ref: `agentspace:${id}`,
      anchor: anchorColor(employee.name),
      recipe: { provider: "google-gemini", model: "imagen-4", prompt: facePrompt(employee) },
    },
    voice: {
      written: {
        rules: voiceRules(employee, exposedSkills, exposedInstructions),
        sample: employee.summary?.trim() || `I am ${employee.name}, ${employee.role}.`,
      },
    },
  };

  if (postsAbout.length > 0) {
    persona.posts_about = postsAbout;
  }

  return persona;
}
