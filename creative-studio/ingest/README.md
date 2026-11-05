# DropEC — Publicaciones automáticas desde catálogo aprobado

Este puente solo conecta el catálogo comercial de **Supabase A** con el área privada de **Creative Studio (Supabase B)**. No conecta directamente con Instagram ni Facebook y no permite ventas, pagos ni cambios a WooCommerce.

## Funcionamiento

1. GitHub Actions valida que el modelo gratuito de Cloudflare está disponible.
2. Un token OIDC efímero, limitado al workflow exacto de main, solicita al endpoint de solo lectura `dropec-creative-feed` los productos **aprobados, publicados en Woo y marcados auto_managed**, con stock conocido y fotografía de catálogo.
3. Solo se admiten productos con tres beneficios extraídos de su ficha. Los reclamos absolutos o de riesgo quedan excluidos; no se inventan ventajas.
4. `/carousel/ingest` introduce **máximo un SKU nuevo por ciclo** y respeta `max_jobs_per_day`. La importación es idempotente (ID determinista) y puede recuperar una inserción incompleta. Se preservan productos ya existentes.
5. `/carousel/auto-prepare` prepara la portada Premium Editorial 02 y encola las escenas 2, 3 y 4. La generación continúa con GitHub Actions, aunque Creative Studio esté cerrado.
6. El panel expone únicamente productos destinados a redes, las cuatro imágenes, la descripción y hashtags. Todos los archivos permanecen en Supabase Storage privado.

## Bloqueos no negociables

- **No hay publicación automática en Meta** en este flujo. El publicador anterior de Supabase A no se activa: las banderas comerciales de lanzamiento y la configuración de contenido continúan cerradas.
- Las afirmaciones del catálogo son declaraciones del proveedor, no ensayos independientes. Las fotos pequeñas o ambiguas pueden producir elementos incorrectos; hasta que se verifiquen no deben usarse comercialmente.
- La ausencia de datos válidos deja el artículo sin importar en vez de inventar contenido.
- No incluye ni modifica las cuatro imágenes existentes de la máquina de ajo y las herramientas.
- Las tareas de GitHub están sujetas a retrasos de programación y a la disponibilidad gratuita de Cloudflare; no garantizan un tiempo fijo por producto.

## Despliegue

- Supabase A: deploy `creative-studio/ingest/catalog-source.ts` como función `dropec-creative-feed` con `verify_jwt=false`. JWT de GitHub Actions se valida dentro con JWKS y audiencia `dropec-creative-premium`.
- Supabase B: deploy `creative-studio/premium/edge/index.ts` como `dropec-premium-scene` con el mismo mecanismo OIDC para sus endpoints de runner; la autenticación de propietario sigue separada.
- GitHub `.github/workflows/dropec-premium-cloudflare-ai.yml` llamará ambos endpoints automáticamente. No se guardan llaves permanentes en el repositorio ni en el navegador.
