"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wormhole_1 = require("../utils/wormhole");
const redisHelper_1 = require("./redisHelper");
process.env.LOG_LEVEL = "debug";
process.env.PROM_PORT = "0";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "0";
const TEST_KEY = `{"chain_id":3,"emitter_address":"0000000000000000000000007cf7b764e38a0a5e967972c1df77d432510564e2","sequence":77391}`;
const TEST_VAA_BYTES = "01000000010d00d37d5af819b2230d7c2b0ad059d03f0410ee01fa05fba3ede9c180004d6e4cb36b8e4383318422a63705451632b3adc3ca85839e23e2c15408eb21e32e5dbbd20002a31149de339b417fbd9e06fdfb9644f48c3b3981811b170556785517f44316c4171367221ba4f3a0a756115c27fef6a636bfb6447862485884500664652bca920103c814d18dddb5816a8310b496d56cacaa9dac294aa25a6c9b4d194df20c5c7ffd22ca2fdbe389e4e05daac51159b2dd73d302eaf9cc9ddc9aa04de2ef4e07dbe3000455f4a08e1a96493129910237dc66db46d20e0baab9a54ee51587651724ddbe1423b4007802505796cace80b992444704af1a3b5f7813055d0beaeba2d93c25b301070b6732602bf0629dfd7ffc71b70900f4ea21ae4a3a03067df685de4f71965b157d6c5e9fcc3f275b64035e307fa71a9d64a1abd213ee00283e8e8c1ed7507d9e000860e4c5539dda95b5a5c3ad82c4fd9023456b095ca9ff1d51e3d3e673ff60805238b70089fdb2e9c00747f9f6d86a5b56bc9a81f3e53fbcb0d0256a1c2be4827e010a532463674858c045328bbcc632df851b0274709eb2bd139401df54fe6d049afe69ca807590c29fe2753b66a84ae1f99209e9e9d273d3a54865691168a9c79f31010b356897c0e0e23c9b3d99cda837fe09b1ef519ed479981473a832791db29b09a31be1cd2d2d64ddb16972d201dc694adea852544df180711d8baa6606f250a27b000c25ec035c97bb0cffcc61cd8b1280c5b03b8080e77a603198bcbffa3fcb946e4924fc201cbd24af179f89779107421edbdb8247bd85984c6b099f0d42611a9695010df05a74cb0924a0952ccf54e1539d6823c828a597176f284697e73ebcb082964f79585affe1f269873ec7eb8b7cf6f605a21fc3db0a22df409c2a30d41a866d00011095bdf09fb178e1ddd950e66e82fcfff99dc220b76f66b51a83513ce4b826ff4b053be0e290c424e4535f5b915fd1992102405c7cc3cffe086b87fccb942c084200118a15aae39395d490b2f5c6fb41e9f7d1ba8594905d62e8250ecc3bc46e71638f4fd35c7e711e30273fd49b8cb349517918eeb8e14885fabf449d10013449497d0012ea54ad52291bac7c031dfb103adf094fc9461758a32a15c93ae02a011126602b09af0a6a389924bd83bb57146962c083040ca6b467dabababb8e8819c277e6e60162586e2900013a2700030000000000000000000000007cf7b764e38a0a5e967972c1df77d432510564e20000000000012e4f000100000000000000000000000000000000000000000000000000000000026271da010000000000000000000000000000000000000000000000000000756c756e610003000000000000000000000000d2499424e5822dc6dadebec9518c1afc1b970be2000a00000000000000000000000000000000000000000000000000000000000017da";
test("should correctly increment sourceToTargetMap", async () => {
    const knownChainIds = Object.keys(wormhole_1.chainIDStrings).map((c) => Number(c));
    const sourceMap = (0, redisHelper_1.createSourceMap)(knownChainIds);
    await (0, redisHelper_1.incrementSourceMap)(TEST_KEY, sourceMap);
    expect(sourceMap[1]).toBe(0);
    expect(sourceMap[3]).toBe(1);
});
//# sourceMappingURL=redisHelper.test.js.map