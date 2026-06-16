import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

// Nota de seguridad: vite 5.x depende de esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99),
// una vulnerabilidad dev-only conocida en la que el dev server responde requests
// cross-origin. Mitigamos atando el host a 'localhost' (no escucha en otras
// interfaces). Revisar este pin cuando Vite 6+ estabilice su ecosistema de plugins.
export default defineConfig(({ mode }) => {
  // Carga todas las variables de entorno (incluidas las que no tienen VITE_)
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [
      react(),
      {
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url && req.url.startsWith('/api/')) {
              const url = new URL(req.url, `http://${req.headers.host}`);
              const apiName = url.pathname.slice(5); // e.g. "create-preference"
              const filePath = path.resolve(__dirname, `./api/${apiName}.ts`);

              if (fs.existsSync(filePath)) {
                try {
                  // Carga y compila el archivo TypeScript dinámicamente usando Vite
                  const module = await server.ssrLoadModule(filePath);

                  // Cast to any to bypass strict Node.js http type checks in config file
                  const anyReq = req as any;
                  const anyRes = res as any;

                  // Mockear req.query
                  const query: Record<string, any> = {};
                  url.searchParams.forEach((val, key) => {
                    query[key] = val;
                  });
                  anyReq.query = query;

                  // Mockear req.body para peticiones POST/PUT
                  if (req.method === 'POST' || req.method === 'PUT') {
                    const bodyPromise = new Promise((resolve) => {
                      let body = '';
                      req.on('data', (chunk: any) => {
                        body += chunk.toString();
                      });
                      req.on('end', () => {
                        try {
                          resolve(JSON.parse(body));
                        } catch {
                          resolve({});
                        }
                      });
                    });
                    anyReq.body = await bodyPromise;
                  }

                  // Mockear métodos de respuesta express/vercel
                  anyRes.status = (code: number) => {
                    res.statusCode = code;
                    return anyRes;
                  };
                  anyRes.json = (data: any) => {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));
                    return anyRes;
                  };
                  anyRes.send = (data: any) => {
                    res.end(data);
                    return anyRes;
                  };
                  anyRes.redirect = (redirectUrl: string) => {
                    res.writeHead(302, { Location: redirectUrl });
                    res.end();
                    return anyRes;
                  };

                  // Ejecutar el handler
                  await module.default(anyReq, anyRes);
                } catch (err: any) {
                  console.error(`[Local API Error] ${apiName}:`, err);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message || 'Error en endpoint local' }));
                }
              } else {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Endpoint /api/${apiName} no encontrado` }));
              }
            } else {
              next();
            }
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: false,
    },
    preview: {
      // allowedHosts: 'all' permite acceder via tunnels (Cloudflare, ngrok, etc.)
      // Solo para dev/testing — en producción esto no aplica (se usa Vercel/hosting real)
      allowedHosts: true,
      host: '0.0.0.0',
      port: 5000,
    },
  };
});
