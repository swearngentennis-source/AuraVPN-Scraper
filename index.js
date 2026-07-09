const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const SOURCES = [
  'https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub',
  'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt',
  'https://raw.githubusercontent.com/mfuu/v2ray/master/v2ray',
  'https://raw.githubusercontent.com/tbbatbb/Proxy/master/main/vless.txt',
  'https://raw.githubusercontent.com/w1770946466/Auto_proxy/main/Long_term_subscription2'
];
const XRAY_BIN = process.env.XRAY_BIN || path.join(__dirname, '..', 'ПК', 'core', 'xray.exe');
const SOCKS_PORT = 10818;
const MAX_TO_TEST = 30; // Test up to 30 nodes for the demo

// URL parser from main app
function generateXrayConfig(vlessUrl) {
  try {
    const urlObj = new URL(vlessUrl);
    if (urlObj.protocol !== 'vless:') return null;

    const uuid = urlObj.username;
    const address = urlObj.hostname;
    const port = parseInt(urlObj.port);
    const params = urlObj.searchParams;

    const type = params.get('type') || 'tcp';
    const security = params.get('security') || 'none';
    
    let config = {
      log: { loglevel: 'none' },
      inbounds: [{
        port: SOCKS_PORT,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { udp: true }
      }],
      outbounds: [{
        protocol: 'vless',
        settings: {
          vnext: [{
            address: address,
            port: port,
            users: [{ id: uuid, encryption: 'none' }]
          }]
        },
        streamSettings: {
          network: type,
          security: security,
        }
      }]
    };
    
    if (security === 'tls') {
        config.outbounds[0].streamSettings.tlsSettings = { serverName: params.get('sni') || address };
    }
    if (security === 'reality') {
        config.outbounds[0].streamSettings.realitySettings = { 
            serverName: params.get('sni') || address,
            publicKey: params.get('pbk') || "", shortId: params.get('sid') || "", spiderX: params.get('spx') || ""
        };
        config.outbounds[0].streamSettings.sockopt = { dialerProxy: "fragment" };
        config.outbounds.push({
            protocol: "freedom", tag: "fragment",
            settings: { fragment: { packets: "tlshello", length: "50-100", interval: "10-20" } }
        });
    }
    if (type === 'ws') {
        config.outbounds[0].streamSettings.wsSettings = { path: params.get('path') || '/', headers: { Host: params.get('host') || address } };
    }

    return config;
  } catch (e) {
    return null;
  }
}

async function testNode(link) {
  const config = generateXrayConfig(link);
  if (!config) return -1;
  
  const configPath = path.join(__dirname, 'temp_config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  
  return new Promise((resolve) => {
    const xray = spawn(XRAY_BIN, ['run', '-c', configPath], { windowsHide: true });
    
    // Wait a little for Xray to start
    setTimeout(async () => {
      try {
        const agent = new SocksProxyAgent(`socks5://127.0.0.1:${SOCKS_PORT}`);
        const start = Date.now();
        const response = await axios.get('http://cp.cloudflare.com/generate_204', { 
          httpAgent: agent,
          timeout: 3000 
        });
        if (response.status === 200 || response.status === 204) {
            const ping = Date.now() - start;
            xray.kill();
            resolve(ping);
        } else {
            xray.kill();
            resolve(-1);
        }
      } catch (err) {
        xray.kill();
        resolve(-1);
      }
    }, 2000); // 2 second delay to let xray connect
  });
}

async function main() {
  let allLinks = [];
  
  for (const source of SOURCES) {
    console.log(`\n[1] Скачиваем сервера из: ${source}`);
    try {
      const response = await axios.get(source, { timeout: 10000 });
      let rawData = response.data.trim();
      let decoded = rawData;
      
      // If it looks like base64
      if (!rawData.includes('vless://') && !rawData.includes('vmess://')) {
        try {
            decoded = Buffer.from(rawData, 'base64').toString('utf-8');
        } catch(e) {}
      }
      
      const links = decoded.split('\n').map(l => l.trim()).filter(l => l.startsWith('vless://'));
      console.log(`    Найдено ${links.length} vless серверов в источнике.`);
      allLinks.push(...links);
    } catch (e) {
      console.log(`    Ошибка скачивания: ${e.message}`);
    }
  }
  
  // Remove duplicates
  allLinks = [...new Set(allLinks)];
  
  console.log(`\n[2] Всего уникальных vless серверов: ${allLinks.length}. Тестируем первые ${MAX_TO_TEST}...`);
  
  const workingLinks = [];
  
  const toTest = allLinks.slice(0, MAX_TO_TEST);
  for (let i = 0; i < toTest.length; i++) {
    process.stdout.write(`Тест ${i+1}/${toTest.length}... `);
    const ping = await testNode(toTest[i]);
    if (ping > 0) {
      console.log(`✅ РАБОТАЕТ (${ping}ms)`);
      const url = new URL(toTest[i]);
      url.hash = `${url.hash.replace('#', '')} [${ping}ms]`;
      workingLinks.push(url.toString());
    } else {
      console.log(`❌ МЁРТВЫЙ (Таймаут)`);
    }
  }
  
  console.log(`\n[3] Итог: ${workingLinks.length} рабочих серверов найдено.`);
  if (workingLinks.length > 0) {
    const finalBase64 = Buffer.from(workingLinks.join('\n')).toString('base64');
    const outPath = path.join(__dirname, 'sub.txt');
    fs.writeFileSync(outPath, finalBase64);
    console.log(`[4] Рабочие сервера сохранены в ${outPath} (Base64)`);
  }
}

main();
