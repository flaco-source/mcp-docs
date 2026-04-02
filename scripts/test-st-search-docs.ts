import { StMicroelectronicsProvider } from "../src/providers/StMicroelectronicsProvider.ts";

async function main() {
    const p = new StMicroelectronicsProvider();
    const r = await p.searchDocs("STM32G071RB");
    console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
