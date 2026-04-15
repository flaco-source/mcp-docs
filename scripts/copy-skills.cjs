/**
 * Copies skill folders into build/resources/skills for production (Docker, node build/index.js).
 * Primary source: src/resources/skills/<id>/SKILL.md (tracked in git).
 * Optional overlay: .cursor/skills (same <id> overwrites — local edits win).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const destRoot = path.join(root, "build", "resources", "skills");

const sources = [
    path.join(root, "src", "resources", "skills"),
    path.join(root, ".cursor", "skills"),
].filter((p) => fs.existsSync(p));

if (sources.length === 0) {
    console.log("copy-skills: no src/resources/skills or .cursor/skills — skip");
    process.exit(0);
}

function copySkillDir(srcDir, id) {
    const md = path.join(srcDir, id, "SKILL.md");
    if (!fs.existsSync(md)) return false;
    const outDir = path.join(destRoot, id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(md, path.join(outDir, "SKILL.md"));
    return true;
}

const ids = new Set();
for (const srcRoot of sources) {
    for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (!/^[a-zA-Z0-9_-]+$/.test(ent.name)) continue;
        if (copySkillDir(srcRoot, ent.name)) ids.add(ent.name);
    }
}

console.log(`copy-skills: copied ${ids.size} skill(s) → build/resources/skills/`);
