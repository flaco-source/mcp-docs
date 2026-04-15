import fs from "fs";
import path from "path";

/** Published MCP resource URI prefix for Cursor skills bundled with this server. */
export const SKILL_RESOURCE_SCHEME = "electronics-docs://skill/";

const SKILL_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Optional: absolute path to a directory of `<id>/SKILL.md` skill folders (overrides discovery). */
const ENV_SKILLS_ROOT = "ELECTRONICS_DOCS_MCP_SKILLS_ROOT";

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
 * Resolves the skills directory:
 * 1. ELECTRONICS_DOCS_MCP_SKILLS_ROOT (if set and valid)
 * 2. build/resources/skills next to the running script (production)
 * 3. Same path via package root (handles odd cwd / inspector layouts)
 * 4. src/resources/skills at package root (version-controlled source — works even without build/skills)
 * 5. .cursor/skills at package root (local Cursor copy)
 * 6. Legacy: ../.cursor/skills and ../src/resources/skills from __dirname
 */
export function resolveSkillsRoot(): string | null {
    const envPath = process.env[ENV_SKILLS_ROOT]?.trim();
    if (envPath) {
        const abs = path.resolve(envPath);
        if (hasSkillMarkdownUnder(abs)) return abs;
    }

    const fromDir = __dirname;
    const candidates: string[] = [];

    candidates.push(path.join(fromDir, "resources", "skills"));

    const root = findPackageRoot(fromDir);
    if (root) {
        candidates.push(path.join(root, "build", "resources", "skills"));
        candidates.push(path.join(root, "src", "resources", "skills"));
        candidates.push(path.join(root, ".cursor", "skills"));
    }

    candidates.push(path.join(fromDir, "..", ".cursor", "skills"));
    candidates.push(path.join(fromDir, "..", "src", "resources", "skills"));

    const seen = new Set<string>();
    for (const c of candidates) {
        const norm = path.resolve(c);
        if (seen.has(norm)) continue;
        seen.add(norm);
        if (hasSkillMarkdownUnder(norm)) return norm;
    }
    return null;
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

export function readSkillFile(skillsRoot: string, skillId: string): string {
    if (!SKILL_ID_RE.test(skillId)) {
        throw new Error("Invalid skill id");
    }
    const filePath = path.join(skillsRoot, skillId, "SKILL.md");
    return fs.readFileSync(filePath, "utf-8");
}

export function getSkillListMetadata(
    skillsRoot: string,
    skillId: string
): { name: string; description: string } {
    const text = readSkillFile(skillsRoot, skillId);
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
