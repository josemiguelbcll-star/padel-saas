import * as fs from 'fs';
import * as path from 'path';

const logPath = 'C:\\Users\\Matka\\.gemini\\antigravity-ide\\brain\\d6404175-9238-4923-9c3a-600531d43760\\.system_generated\\logs\\transcript_full.jsonl';

function run() {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  console.log(`Read ${lines.length} lines.`);
  let found = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('fn_eliminar_bloqueo_torneo') || line.includes('eliminar_bloqueo_torneo')) {
      console.log(`Line ${i} contains the word!`);
      // print first 500 characters
      console.log(line.slice(0, 800));
      found++;
    }
  }
  console.log(`Found ${found} occurrences.`);
}
run();
