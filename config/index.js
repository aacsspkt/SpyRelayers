import { writeFileSync } from 'fs';

const tokenBridge = {
    emmiterAddress: [
        { "chainId": 1, "emitterAddress": "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe" },
        { "chainId": 2, "emitterAddress": "0xF890982f9310df57d00f659cf4fd87e65adEd8d7" },
        { "chainId": 4, "emitterAddress": "0x9dcF9D205C9De35334D646BeE44b2D2859712A09" },
    ],

    privateKeys: [
        {
            "chainId": 1,
            "privateKeys": [
                [
                    90, 136, 26, 232, 164, 37, 69, 48, 61, 93, 186, 200, 128, 201, 96, 142, 27, 94, 87, 124, 177, 166, 93, 60, 193,
                    231, 146, 80, 57, 104, 136, 7, 53, 8, 189, 218, 126, 111, 209, 146, 40, 66, 89, 174, 123, 64, 84, 69, 164, 16,
                    180, 245, 117, 243, 94, 138, 214, 87, 155, 227, 96, 233, 202, 12
                ]
            ]
        },
        {
            "chainId": 2,
            "privateKeys": ["2077bf909af85fb48b71df11e74a9b8b6009f3517a54c8cd1c8f8abb12ce408b"]
        },
        {
            "chainId": 4,
            "privateKeys": ["2077bf909af85fb48b71df11e74a9b8b6009f3517a54c8cd1c8f8abb12ce408b"]
        },
    ],

    supportedChains: [
        {
            "chainId": 1,
            "chainName": "Solana",
            "nativeCurrencySymbol": "SOL",
            "nodeUrl": "https://api.devnet.solana.com/",
            "tokenBridgeAddress": "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe",
            "bridgeAddress": "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",
            "wrappedAsset": "So11111111111111111111111111111111111111112"
        },
        {
            "chainId": 2,
            "chainName": "Ethereum",
            "nativeCurrencySymbol": "ETH",
            "nodeUrl": "https://eth-goerli.g.alchemy.com/v2/6VQ1A0Vii0O9pc5GJ09UwnmgiONFEdcQ",
            "tokenBridgeAddress": "0xF890982f9310df57d00f659cf4fd87e65adEd8d7",
            "bridgeAddress": "0x706abc4E45D419950511e474C7B9Ed348A4a716c",
            "wrappedAsset": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
        },
        {
            "chainId": 4,
            "chainName": "Binance Smart Chain",
            "nativeCurrencySymbol": "BNB",
            "nodeUrl": "https://data-seed-prebsc-1-s1.binance.org:8545/",
            "tokenBridgeAddress": "0x9dcF9D205C9De35334D646BeE44b2D2859712A09",
            "bridgeAddress": "0x68605AD7b15c732a30b1BbC62BE8F2A509D74b4D",
            "wrappedAsset": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
        },
    ],

    supportedTokens: [
        {
            "chainId": 1,
            "address": "So11111111111111111111111111111111111111112"
        },
        {
            "chainId": 1,
            "address": "6XSp58Mz6LAi91XKenjQfj9D1MxPEGYtgBkggzYvE8jY"
        },
        {
            "chainId": 2,
            "address": "0x4Bc9AF5EBED4e3202516153418b7128b1F6B97aE"
        },
        {
            "chainId": 2,
            "address": "0x01a8Ad4418d4F9c66c4C1e263aF1D2B4B8417330"
        },
    ]
}

const zebecBridge = {
    emmiterAddress: [
        { "chainId": 1, "emitterAddress": "67z6hxWS8XPtogeGHjmns19ytn998FDgmCxztVwWu53o" },
        { "chainId": 4, "emitterAddress": "0xc59fbf3fFFc227B2935e7Bb26f2bf21D12B5C9f9" },
    ],

    privateKeys: [
        {
            "chainId": 1,
            "privateKeys": [
                [
                    90, 136, 26, 232, 164, 37, 69, 48, 61, 93, 186, 200, 128, 201, 96, 142, 27, 94, 87, 124, 177, 166, 93, 60, 193,
                    231, 146, 80, 57, 104, 136, 7, 53, 8, 189, 218, 126, 111, 209, 146, 40, 66, 89, 174, 123, 64, 84, 69, 164, 16,
                    180, 245, 117, 243, 94, 138, 214, 87, 155, 227, 96, 233, 202, 12
                ]
            ]
        },
        {
            "chainId": 4,
            "privateKeys": ["2077bf909af85fb48b71df11e74a9b8b6009f3517a54c8cd1c8f8abb12ce408b"]
        },
    ],

    supportedChains: [
        {
            "chainId": 1,
            "chainName": "Solana",
            "nativeCurrencySymbol": "SOL",
            "nodeUrl": "https://api.devnet.solana.com/",
            "tokenBridgeAddress": "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe",
            "bridgeAddress": "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",
            "wrappedAsset": "So11111111111111111111111111111111111111112"
        },
        {
            "chainId": 4,
            "chainName": "Binance Smart Chain",
            "nativeCurrencySymbol": "BNB",
            "nodeUrl": "https://data-seed-prebsc-1-s1.binance.org:8545/",
            "tokenBridgeAddress": "0x9dcF9D205C9De35334D646BeE44b2D2859712A09",
            "bridgeAddress": "0x68605AD7b15c732a30b1BbC62BE8F2A509D74b4D",
            "wrappedAsset": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
        },
    ],
}

const tokenBridgeEnvironment = "SPY_SERVICE_FILTERS=" + JSON.stringify(tokenBridge.emmiterAddress) + "\n" +
    "SUPPORTED_CHAINS=" + JSON.stringify(tokenBridge.supportedChains) + "\n" +
    "SUPPORTED_TOKENS=" + JSON.stringify(tokenBridge.supportedTokens) + "\n" +
    "PRIVATE_KEYS=" + JSON.stringify(tokenBridge.privateKeys) + "\n";

const zebecBridgeEnvironment = "SPY_SERVICE_FILTERS=" + JSON.stringify(zebecBridge.emmiterAddress) + "\n" +
    "SUPPORTED_CHAINS=" + JSON.stringify(zebecBridge.supportedChains) + "\n" +
    "PRIVATE_KEYS=" + JSON.stringify(zebecBridge.privateKeys) + "\n";

const file1 = "tokenBridge.env";
const file2 = "zebecBridge.env";

writeFileSync(file1, tokenBridgeEnvironment, "utf-8");
writeFileSync(file2, zebecBridgeEnvironment, "utf-8");