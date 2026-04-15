import fs from "fs";
import path from "path";

/** Published MCP resource URI prefix for Cursor skills bundled with this server. */
export const SKILL_RESOURCE_SCHEME = "electronics-docs://skill/";

const SKILL_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Optional: absolute path to a directory of `<id>/SKILL.md` skill folders (overrides discovery). */
const ENV_SKILLS_ROOT = "ELECTRONICS_DOCS_MCP_SKILLS_ROOT";

/**
 * Resolved skill locations. Matches copy-skills.cjs: merged `build/` output, else overlay
 * `.cursor/skills` over `src/resources/skills` (cursor wins per id).
 */
export type SkillSources =
    | { mode: "merged"; root: string }
    | { mode: "overlay"; srcRoot: string | null; cursorRoot: string | null };

function findPackageRoot(startDir: string): string | null {
    let dir = path.resolve(startDir);
    for (let i = 0; i < 12; i++) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const raw = fs.readFileSync(pkgPath, "utf-8");
                const j = JSON.parse(raw) as { name?: string };
                if (j.name === "mcp-docs") return dir;
            } catch {
                /* invalid package.json */
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function hasSkillMarkdownUnder(rootDir: string): boolean {
    if (!fs.existsSync(rootDir)) return false;
    try {
        for (const ent of fs.readdirSync(rootDir, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            if (fs.existsSync(path.join(rootDir, ent.name, "SKILL.md"))) return true;
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Resolves where skill Markdown lives:
 * 1. `ELECTRONICS_DOCS_MCP_SKILLS_ROOT` (if set and valid) — single tree
 * 2. **Merged** `build/resources/skills` only when the entrypoint runs from `build/` (production / `node build/...`)
 * 3. Otherwise **overlay** mode: union of ids from `src/resources/skills` and `.cursor/skills`; per-id read prefers `.cursor` (same order as copy-skills overlay)
 *
 * Skips (2) when running from `src/` (e.g. tsx) so a stale `build/` does not hide `.cursor` edits before rebuild.
 */
export function resolveSkillSources(): SkillSources | null {
    const envPath = process.env[ENV_SKILLS_ROOT]?.trim();
    if (envPath) {
        const abs = path.resolve(envPath);
        if (hasSkillMarkdownUnder(abs)) return { mode: "merged", root: abs };
    }

    const fromDir = __dirname;
    const runningFromBuildTree = path.basename(fromDir) === "build";

    if (runningFromBuildTree) {
        const adjacent = path.join(fromDir, "resources", "skills");
        if (hasSkillMarkdownUnder(adjacent)) {
            return { mode: "merged", root: path.resolve(adjacent) };
        }
        const root = findPackageRoot(fromDir);
        if (root) {
            const merged = path.join(root, "build", "resources", "skills");
            if (hasSkillMarkdownUnder(merged)) {
                return { mode: "merged", root: path.resolve(merged) };
            }
        }
    }

    const root = findPackageRoot(fromDir);
    let srcRoot: string | null = null;
    let cursorRoot: string | null = null;

    if (root) {
        const s = path.join(root, "src", "resources", "skills");
        if (hasSkillMarkdownUnder(s)) srcRoot = path.resolve(s);
        const c = path.join(root, ".cursor", "skills");
        if (hasSkillMarkdownUnder(c)) cursorRoot = path.resolve(c);
    }

    const legacyCursor = path.resolve(path.join(fromDir, "..", ".cursor", "skills"));
    const legacySrc = path.resolve(path.join(fromDir, "..", "src", "resources", "skills"));
    if (!cursorRoot && hasSkillMarkdownUnder(legacyCursor)) cursorRoot = legacyCursor;
    if (!srcRoot && hasSkillMarkdownUnder(legacySrc)) srcRoot = legacySrc;

    if (!srcRoot && path.basename(fromDir) !== "build") {
        const adjacentSrc = path.resolve(path.join(fromDir, "resources", "skills"));
        if (hasSkillMarkdownUnder(adjacentSrc)) srcRoot = adjacentSrc;
    }

    if (!srcRoot && !cursorRoot) return null;
    return { mode: "overlay", srcRoot, cursorRoot };
}

export function listSkillIds(skillsRoot: string): string[] {
    const ids: string[] = [];
    for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (!SKILL_ID_RE.test(ent.name)) continue;
        if (fs.existsSync(path.join(skillsRoot, ent.name, "SKILL.md"))) ids.push(ent.name);
    }
    return ids.sort();
}

/** Ids to expose: merged folder, or union of overlay trees (copy-skills semantics). */
export function listResolvedSkillIds(sources: SkillSources): string[] {
    if (sources.mode === "merged") {
        return listSkillIds(sources.root);
    }
    const ids = new Set<string>();
    if (sources.srcRoot) {
        for (const id of listSkillIds(sources.srcRoot)) ids.add(id);
    }
    if (sources.cursorRoot) {
        for (const id of listSkillIds(sources.cursorRoot)) ids.add(id);
    }
    return [...ids].sort();
}

function skillMarkdownPath(root: string, skillId: string): string {
    return path.join(root, skillId, "SKILL.md");
}

export function readResolvedSkill(sources: SkillSources, skillId: string): string {
    if (!SKILL_ID_RE.test(skillId)) {
        throw new Error("Invalid skill id");
    }
    if (sources.mode === "merged") {
        return fs.readFileSync(skillMarkdownPath(sources.root, skillId), "utf-8");
    }
    for (const root of [sources.cursorRoot, sources.srcRoot]) {
        if (!root) continue;
        const p = skillMarkdownPath(root, skillId);
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    }
    throw new Error(`Skill not found: ${skillId}`);
}

function parseFrontmatter(raw: string): { name?: string; description?: string } {
    if (!raw.startsWith("---\n")) return {};
    const end = raw.indexOf("\n---\n", 4);
    if (end === -1) return {};
    const fm = raw.slice(4, end);
    const nameMatch = fm.match(/^name:\s*(.+?)\s*$/m);
    const block = fm.match(/^description:\s*>\-\s*\n((?:  .+\n)+)/m);
    let description: string | undefined;
    if (block) {
        description = block[1]
            .split("\n")
            .map((line) => line.replace(/^  /, "").trimEnd())
            .join(" ")
            .trim();
    }
    if (!description) {
        const oneLine = fm.match(/^description:\s*(.+)$/m);
        if (oneLine) description = oneLine[1].trim();
    }
    return {
        name: nameMatch?.[1]?.trim(),
        description,
    };
}

export function getSkillListMetadata(
    sources: SkillSources,
    skillId: string
): { name: string; description: string } {
    const text = readResolvedSkill(sources, skillId);
    const meta = parseFrontmatter(text);
    return {
        name: meta.name ?? skillId,
        description: meta.description ?? `Cursor agent skill: ${skillId} (Markdown).`,
    };
}

export function skillResourceUri(skillId: string): string {
    return `${SKILL_RESOURCE_SCHEME}${skillId}`;
}

export function parseSkillResourceUri(uri: string): string | null {
    if (!uri.startsWith(SKILL_RESOURCE_SCHEME)) return null;
    const id = uri.slice(SKILL_RESOURCE_SCHEME.length);
    return SKILL_ID_RE.test(id) ? id : null;
}
