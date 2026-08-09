# Architecture

Project BMO debe mantener separada la inteligencia de sus interfaces físicas.

## Arquitectura conceptual

BMO Core
|
+-- Intelligence
+-- Personality
+-- Memory
+-- Perception
+-- Skills
+-- Safety
|
+-- Desktop (macOS)
+-- Mobile (Android, futuro)
+-- Robot (futuro)

## Core

El Core contendrá lógica independiente de plataforma.

Responsabilidades futuras:

- sesiones;
- memoria;
- personalidad;
- selección de modelo;
- herramientas;
- permisos;
- planificación;
- contexto;
- eventos;
- iniciativa.

## Intelligence

Los modelos deberán utilizarse mediante una abstracción.

Ejemplo conceptual:

LLMProvider
|
+-- Ollama
+-- otros proveedores locales futuros

No asumir que un único modelo será utilizado para siempre.

Modelo inicial:

qwen3.5:4b

## Modos de razonamiento

Fast Mode:
- conversación cotidiana;
- respuestas rápidas;
- thinking desactivado.

Think Mode:
- programación;
- análisis;
- planificación compleja;
- resolución de problemas.

## Desktop

La aplicación macOS será una interfaz del Core.

Responsabilidades:

- ventana;
- personaje;
- animaciones;
- entrada de texto;
- audio;
- permisos de macOS;
- cámara;
- pantalla;
- interacción con escritorio.

La lógica de personalidad o memoria no debe vivir exclusivamente aquí.

## Character

El personaje utilizará sprites diseñados para Project BMO.

Estados iniciales previstos:

- idle
- blink
- thinking
- talking
- happy
- sleeping

Posteriormente podrán añadirse más expresiones.

## Perception

Fuentes posibles:

- cámara del Mac;
- captura de pantalla;
- micrófono;
- aplicaciones activas;
- sensores futuros.

La percepción debe transformarse cuando sea posible en información semántica antes de entregarla al LLM.

## Skills

Las acciones se implementarán como habilidades específicas.

Ejemplos futuros:

- Finder
- Spotify
- navegador
- VS Code
- calendario
- control de volumen
- archivos

Debe preferirse una API o comando fiable antes que simular ratón/teclado.

## Safety

Acciones sensibles deben solicitar confirmación.

Ejemplos:

- borrar archivos;
- enviar mensajes;
- enviar emails;
- instalar software;
- ejecutar comandos peligrosos;
- compras;
- modificar configuraciones críticas.

Debe existir en el futuro un mecanismo de parada inmediata.
