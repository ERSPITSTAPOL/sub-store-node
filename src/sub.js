import { ProxyUtils } from './sub/backend/src/core/proxy-utils/index.js';
import PROXY_PRODUCERS from './sub/backend/src/core/proxy-utils/producers/index.js';
import YAML from 'yaml';

const HOP_BY_HOP_HEADERS = new Set(['transfer-encoding', 'content-length', 'content-encoding', 'connection']);
const USER_AGENT_REGEX = /(?:clash|meta|mihomo|ray)/i;
const BASE64_REGEX = /^[A-Za-z0-9+/]+[=]{0,3}$/;

export default async function processNodeConversion(urlArray, platform, userAgent) {
    const results = {
        data: {},
        headers: [],
    };
    if (!urlArray || urlArray.length === 0) {
        results.status = 400;
        results.data = '输入节点数组不能为空';
        return results;
    }
    if (!PROXY_PRODUCERS[platform]) {
        results.status = 400;
        results.data = `目标平台：不支持 ${platform}!`;
        return results;
    }
    try {
        const globalNameCount = new Map();
        const processedResults = await Promise.all(
            urlArray.map((input, index) => processSingleInput(input, platform, index, globalNameCount, userAgent))
        );
        mergeResults(results, processedResults);
    } catch (error) {
        results.status = 500;
        results.data = `处理节点失败：${error.message}`;
        return results;
    }
    results.status = 200;
    return results;
}

async function processSingleInput(input, platform, index, globalNameCount, userAgent) {
    let data = input;
    let headers = {};
    const isHttpInput = /^https?:\/\//i.test(input);

    if (isHttpInput) {
        const response = await fetchResponse(input, userAgent);
        headers = response?.headers ?? {};
        data = response?.data ?? response;
    }

    if (data && typeof data === 'object' && data.proxies) {
        const produced = ProxyUtils.produce(data.proxies, platform);
        return { data: produced, headers, index };
    }

    const proxies = ProxyUtils.parse(data) || [];
    const deduped = deduplicateWithGlobalMap(Array.isArray(proxies) ? proxies : [proxies], globalNameCount);
    const produced = ProxyUtils.produce(deduped, platform);

    return { data: produced, headers, index };
}

function mergeResults(results, processedResults) {
    let textdata = '';
    let hasBase64 = false;
    let objectDataArray = null;
    let headerCount = 0;

    for (let i = 0, len = processedResults.length; i < len; i++) {
        const { data, headers } = processedResults[i];

        if (typeof data === 'string') {
            if (isBase64(data)) {
                hasBase64 = true;
                textdata += base64DecodeUtf8(data) + '\n';
            } else {
                let loaded = null;
                try {
                    loaded = YAML.parse(data, { maxAliasCount: -1, merge: true });
                } catch {}

                if (loaded && typeof loaded === 'object') {
                    const keys = Object.keys(loaded);
                    for (let k = 0, kLen = keys.length; k < kLen; k++) {
                        const key = keys[k];
                        const val = loaded[key];
                        if (key === '0') {
                            if (!objectDataArray) objectDataArray = [];
                            objectDataArray.push(val);
                        } else if (Array.isArray(val)) {
                            if (!Array.isArray(results.data[key])) {
                                results.data[key] = [];
                            }
                            results.data[key].push(...val);
                        }
                    }
                } else {
                    results.data = data;
                }
            }
        } else {
            results.data = data;
        }

        if (headers) {
            for (const _ in headers) {
                if (Math.random() * ++headerCount < 1) {
                    results.headers = headers;
                }
                break;
            }
        }
    }

    if (hasBase64) {
        results.data = base64EncodeUtf8(textdata);
    }

    if (objectDataArray) {
        results.data = objectDataArray;
    }

    if (results.data.proxies) {
        results.data = YAML.stringify(results.data, { lineWidth: 0 });
    }
}

function deduplicateWithGlobalMap(proxies, globalNameCount) {
    for (let i = 0, len = proxies.length; i < len; i++) {
        const proxy = proxies[i];
        const baseName = proxy.name || 'node';
        const newCount = (globalNameCount.get(baseName) ?? -1) + 1;

        globalNameCount.set(baseName, newCount);
        proxy.name = newCount === 0 ? baseName : `${baseName} [${newCount}]`;
    }
    return proxies;
}

async function fetchResponse(url, userAgent) {
    userAgent = (userAgent && USER_AGENT_REGEX.test(String(userAgent)))
        ? userAgent
        : 'ClashMetaForAndroid';

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { 
                'User-Agent': userAgent,
                'Accept': 'text/plain,application/yaml,application/json,*/*'
            },
        });
    } catch (error) {
        throw new Error(
            `Failed to fetch subscription: ${url}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Failed to fetch subscription: ${url}: HTTP ${response.status} ${response.statusText}`
        );
    }

    const headers = {};
    response.headers.forEach((value, key) => {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
            headers[key] = value;
        }
    });

    const textData = await response.text();
    let data = textData;

    if (textData.includes('proxies')) {
        try {
            const tempParsed = YAML.parse(textData, { maxAliasCount: -1, merge: true });
            if (tempParsed && typeof tempParsed === 'object') {
                data = tempParsed.proxies ? { proxies: tempParsed.proxies } : tempParsed;
            }
        } catch {
            data = textData;
        }
    }

    return {
        status: response.status,
        headers,
        data,
    };
}

const isBase64 = (str) => {
    return str.length % 4 === 0 && BASE64_REGEX.test(str);
}

function base64EncodeUtf8(str) {
    const bytes = new TextEncoder('utf-8').encode(str);
    const binary = String.fromCharCode.apply(null, bytes);
    return btoa(binary);
}

function base64DecodeUtf8(str) {
    const binary = atob(str);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
}