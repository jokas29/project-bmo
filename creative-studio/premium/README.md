# DropEC Premium — Portada editorial solo producto y nombre

## Dirección visual aprobada para ensayar

El usuario descartó la portada cargada de etiquetas y el número decorativo 02.
El diseño Premium se limita a **exactamente dos contenidos visuales**:

1. El nombre auténtico del producto del catálogo, sin abreviar ni inventar,
   en **ANTON** (tipografía gratuita, condensada y de gran peso), presentado
   en mayúsculas conservando tildes y ñ.
2. El producto generado por FLUX, separado del fondo por rembg CPU,
   en primer plano, grande, sin cortar ningún componente.

No lleva logotipo DropEC, número gigante 01/02/03, «edición», «DROP EC /
02», precio, llamada a la acción, contacto, slogan, características o
líneas ornamentales. El precio puede existir en los datos de origen, pero
**no se dibuja en la portada**. El fondo ahora es **una escena gráfica cinematográfica continua** en
violetas profundos, con halos volumétricos, rebotes de iluminación,
microtextura, arcos de luz y un suelo ligeramente reflectante. Todos esos
elementos están **detrás del producto**, sin otro texto y sin foto
rectangular o paneles grises. Conservamos el alto contraste y la tipografía
Anton; el último renglón del nombre puede acentuarse en verde lima.
Esto recupera profundidad y detalle de las primeras pruebas sin reintroducir
precios, títulos ficticios ni productos secundarios.

La estructura se aplica igual a cada SKU; no hay código especial para la
máquina de ajo ni para otros productos. Hay 3 posibles colocaciones
sutilmente diferentes del producto, pero la portada nunca muestra el número
de variante. Los ejemplos de marcas o modelos de las imágenes del usuario
solo orientan el lenguaje visual y la tipografía, no son productos reales
para añadir al catálogo.

## Tipografía libre, de origen comprobable

El archivo `install_display_font.sh` descarga exclusivamente en el
ejecutor efímero de GitHub el archivo oficial `Anton-Regular.ttf` del
repositorio **google/fonts**, licencia SIL Open Font License 1.1. Comprueba
su Git blob SHA-1 `4d65707db9d8663ccfa99cd28cd3a4e0025be178` para
evitar cambios silenciosos y verifica la aparición de glifos con tildes.
No se incorpora ni entrega al usuario ningún archivo tipográfico
propietario. Anton es una alternativa de lenguaje similar, no Movault.

## Secuencia automatizada y salvaguardas

1. El usuario prepara la portada en Creative Studio; queda bloqueada como
   propuesta privada en Supabase B. El estilo ambiental se elige por variante,
   no por ID de producto; los tres fondos se generan de forma determinista
   en CPU con Pillow, sin una segunda llamada a modelos de pago.
2. GitHub comprueba la disponibilidad gratuita del generador antes de
   reclamar un trabajo en cola. El Mac no necesita estar encendido.
3. FLUX.2 reinterpreta la foto de origen cuando existe, evitando reutilizar
   su publicidad; sin foto genera una interpretación conceptual del objeto.
4. `rembg[cpu]` y `u2netp` extraen el producto. Si no pueden obtener un
   objeto visible completo, el sistema falla sin presentar un anuncio falso.
5. Pillow compone solo el nombre y la imagen. La foto del catálogo no se
   pega en un rectángulo ni se sustituye al modelo.
6. El JPEG 736×1104 (2:3) se guarda en almacenamiento **privado**. Los
   originales anteriores se conservan en el historial antes de regenerar.
   Sin aprobación ni publicación automática en redes.

**Importante:** con una foto de baja calidad el modelo puede alterar
materiales o componentes; ninguna prueba técnica sustituye la revisión de
identidad comercial. Si la foto original falta, la advertencia
«IMAGEN ILUSTRATIVA — modelo no verificado» permanece **fuera de la
imagen** en la interfaz de revisión. No aceptar la portada sin verificar
el objeto. El formato 2:3 aún no equivale a un archivo optimizado para
todas las redes sociales.

## Pruebas

`test_compositor.py` intercepta el texto dibujado para comprobar que
**no aparece nada salvo el nombre exacto en mayúsculas**, evalúa dimensiones,
tildes, precio omitido, las tres variantes cinematográficas con profundidad
lumínica, nombres de distintas categorías, escala del producto y recorte. Los workflows de CI verifican
que ambos ejecutores instalan la fuente oficial validada, que la
segmentación es gratuita y que se mantiene la seguridad de staging/OIDC.
