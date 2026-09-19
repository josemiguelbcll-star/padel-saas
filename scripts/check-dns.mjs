import dns from 'dns/promises';

async function check() {
  const ref = 'bpvpxjwripilymetfujz';
  const subdomains = [
    `db.${ref}.supabase.co`,
    `${ref}.supabase.co`,
  ];
  
  for (const s of subdomains) {
    try {
      const v4 = await dns.resolve4(s);
      console.log(`${s} IPv4:`, v4);
    } catch (e) {
      console.log(`${s} IPv4 error:`, e.code);
    }
    try {
      const v6 = await dns.resolve6(s);
      console.log(`${s} IPv6:`, v6);
    } catch (e) {
      console.log(`${s} IPv6 error:`, e.code);
    }
  }
}

check();
