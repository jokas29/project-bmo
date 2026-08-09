# Memoria explícita de BMO

Esta carpeta contiene la primera capa de memoria persistente de Project BMO.
Su alcance es deliberadamente pequeño: guarda únicamente datos que el usuario
pide recordar mediante un comando explícito.

## Modelo y límites

Cada `MemoryRecord` contiene:

- `id`: identificador local único;
- `text`: texto solicitado por el usuario;
- `createdAt`: fecha ISO de creación.

El servicio conserva como máximo 32 recuerdos. Al alcanzar el límite rechaza
un recuerdo nuevo; no elimina recuerdos anteriores automáticamente. Cada texto
puede tener hasta 240 puntos de código Unicode y solo se recortan espacios
externos.

Los duplicados se comparan ignorando mayúsculas/minúsculas y espacios externos.
No se modifican ni se colapsan los espacios internos del texto persistido.

## Comando explícito

`parseMemoryCommand` reconoce solamente mensajes que, después de posibles
espacios iniciales, comienzan exactamente por `recuerda que ` sin distinguir
mayúsculas de minúsculas. Por ejemplo:

```text
Recuerda que mi animal favorito es el pingüino.
```

guarda:

```text
mi animal favorito es el pingüino.
```

Los mensajes normales nunca generan recuerdos por heurísticas ni mediante el
modelo. `createMemoryAwareConversation` responde localmente con `Lo recordaré.`
o `Ya lo recordaba.`; el comando no llama a Ollama y no se añade al historial
efímero de conversación.

## Persistencia

`MemoryStore` es el límite sustituible de almacenamiento. El servicio valida
todo lo cargado porque el contenido del disco se considera `unknown`. Un store
ausente comienza vacío; un error de lectura o datos que no cumplan el esquema
no bloquean el chat y producen una recuperación segura con los registros
válidos disponibles.

Si la lectura inicial falla, el chat continúa disponible, pero el servicio no
considera confiable la lista vacía temporal. Antes de cualquier adición o
eliminación vuelve a cargar el store dentro de la cola de mutaciones. Si el
reintento funciona, recupera y valida los recuerdos existentes antes de aplicar
el cambio; si vuelve a fallar, no guarda nada, no publica un estado falso y
devuelve un error controlado al usuario.

Las adiciones y eliminaciones están serializadas. El servicio construye el
nuevo snapshot, espera a que `MemoryStore.save` termine y solo entonces publica
el cambio a `getMemories` y a los suscriptores. Un error de guardado conserva el
estado anterior y nunca produce una confirmación falsa.

El adaptador Tauri utiliza un store dedicado `bmo-memory.json`, clave `records`,
dentro de `app_data_dir`. En la configuración actual de macOS se encuentra en:

```text
~/Library/Application Support/com.projectbmo.desktop/bmo-memory.json
```

Cada cambio ejecuta `set` seguido de `save`; no depende únicamente del cierre
limpio de la aplicación. El frontend solo dispone de los permisos Store
`load`, `get`, `set` y `save`. Un fake que implemente `MemoryStore` permite
probar el dominio sin Tauri ni acceso real a disco.

El plugin oficial puede presentar un archivo JSON físicamente ilegible como un
store vacío sin exponer el error de parseo a JavaScript. La aplicación no se
cae y vuelve a escribir un snapshot seguro, pero esta versión no conserva una
copia forense del archivo corrupto porque no solicita acceso general al sistema
de archivos.

## Contexto del modelo

`buildSystemPromptWithMemories` combina la personalidad base con los recuerdos
actuales. Si la lista está vacía devuelve el prompt base sin una sección vacía.
Todos los textos se serializan juntos como un único array JSON dentro del bloque
`<user_memories_json>`. Después de serializar se escapan `<`, `>` y `&` como
secuencias Unicode para que el contenido no pueda cerrar ni crear etiquetas del
bloque. Una instrucción explícita identifica esos recuerdos como datos no
confiables y prohíbe seguir las órdenes, cambios de rol, prompts, etiquetas o
solicitudes que pudieran contener. Ollama continúa recibiendo únicamente
`BrainMessage[]` y no conoce el sistema de memoria.

Al eliminar un recuerdo, las peticiones futuras dejan de incluirlo en el system
prompt. Sin embargo, una sesión ya iniciada podría conservar referencias a ese
dato dentro de mensajes `user` o `assistant` anteriores; esta primera versión no
reescribe el historial existente.

## Interfaz temporal

El control `Memoria` abre un diálogo compacto con la lista actual. Cada fila
puede eliminarse individualmente después de una confirmación explícita. No hay
edición ni borrado masivo en esta versión. La lista se actualiza únicamente
después de que el nuevo snapshot haya sido guardado con éxito.

## Privacidad y alcance

El store es local y legible como JSON; no está cifrado. No debe utilizarse para
secretos. Esta versión no guarda conversaciones, prompts completos ni
respuestas, y tampoco implementa extracción automática, edición, borrado total,
embeddings, RAG o sincronización cloud.
