import { execSync } from 'child_process';
import * as path from 'path';

try {
  const result = execSync('npx supabase db psql -c "SELECT proname, prosrc FROM pg_proc WHERE prosrc ILIKE \'%nuevo esquema%\' OR prosrc ILIKE \'%obligatorio%\';"', { encoding: 'utf8' });
  console.log(result);
} catch (e) {
  console.error(e.stdout);
}
