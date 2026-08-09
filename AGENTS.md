# Instructions for coding agents

Este repositorio pertenece a Project BMO.

Antes de modificar código, leer:

- README.md
- docs/VISION.md
- docs/ARCHITECTURE.md
- docs/ROADMAP.md

## Reglas fundamentales

1. No introducir APIs o servicios de pago como dependencia obligatoria.
2. Priorizar funcionamiento local.
3. La plataforma principal actual es macOS Apple Silicon.
4. El hardware de desarrollo tiene 8 GB de memoria.
5. Evitar dependencias pesadas sin una razón clara.
6. Separar BMO Core de las interfaces desktop/mobile/robot.
7. No almacenar vídeo o audio permanentemente por defecto.
8. Cámara, micrófono, pantalla y control del sistema deben tener permisos explícitos.
9. Acciones destructivas o sensibles deben requerir confirmación.
10. No hacer refactors grandes que no sean necesarios para la tarea solicitada.
11. Mantener las implementaciones modulares.
12. Añadir pruebas cuando una función tenga lógica no trivial.
13. Explicar cualquier cambio arquitectónico importante antes de implementarlo.

## IA local actual

Runtime:
- Ollama

Modelo inicial:
- qwen3.5:4b

Uso:
- conversación normal: thinking disabled
- tareas complejas: thinking enabled

## OpenJarvis

OpenJarvis está instalado, pero Project BMO NO debe quedar fuertemente acoplado a él.

Se detectó que `jarvis chat` no estaba conservando correctamente el contexto en una prueba inicial, mientras que ejecutar qwen3.5:4b directamente con Ollama sí conservó el contexto.

Por ello, cualquier integración de OpenJarvis debe hacerse detrás de interfaces/adapters sustituibles.

## Regla de alcance

Implementar únicamente la tarea solicitada.

No añadir funciones futuras (Android, robot, Kinect, etc.) a menos que la tarea actual lo requiera.
