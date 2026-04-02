import { TexasInstrumentsProvider } from "../src/providers/TexasInstrumentsProvider.ts";

async function main() {
    const p = new TexasInstrumentsProvider();
    const r = await p.lookupDoc("BQ40Z50-R2", "SafetyAlert() register definition bits description", {
        maxDocsToIndex: 4,
    });
    console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
