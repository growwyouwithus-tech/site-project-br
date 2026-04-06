const dns = require('dns');
const fs = require('fs');

dns.setServers(['8.8.8.8', '1.1.1.1']);
dns.resolveSrv('_mongodb._tcp.cluster0.racbswp.mongodb.net', (err, addresses) => {
  let srv = err ? err.message : addresses;
  dns.resolveTxt('cluster0.racbswp.mongodb.net', (err, records) => {
    let txt = err ? err.message : records;
    fs.writeFileSync('dns-output.json', JSON.stringify({srv, txt}, null, 2));
  });
});
