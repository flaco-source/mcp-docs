export type VendorKey = "TI" | "ST" | "ADI";

export const fixtures: Record<
    VendorKey,
    { defaultPart: string; defaultQuestion: string; sampleReadUrl: string }
> = {
    TI: {
        defaultPart: "BQ40Z50",
        defaultQuestion: "0x51",
        sampleReadUrl: "https://www.ti.com/lit/ds/symlink/csd88599q5dc.pdf",
    },
    ST: {
        defaultPart: "STM32G071RB",
        defaultQuestion: "GPIO alternate function",
        sampleReadUrl: "https://www.st.com/resource/en/datasheet/stm32g431rb.pdf",
    },
    ADI: {
        defaultPart: "ADAU1701",
        defaultQuestion: "PLL",
        sampleReadUrl:
            "https://www.analog.com/media/en/technical-documentation/data-sheets/ADAU1701.pdf",
    },
};
