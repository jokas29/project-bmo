# Project BMO

Project BMO es un asistente personal de IA local-first diseñado para sentirse como un compañero digital, no solamente como un chatbot.

## Objetivo

Construir un asistente que pueda:

- conversar naturalmente;
- recordar al usuario y conversaciones importantes;
- hablar y escuchar;
- tener un personaje animado mediante sprites;
- ver mediante la cámara cuando tenga permiso;
- entender lo que ocurre en la pantalla;
- iniciar conversaciones de forma contextual;
- controlar el Mac mediante herramientas seguras;
- funcionar principalmente de forma local y gratuita.

## Plataformas

El desarrollo seguirá este orden:

1. macOS
2. Android
3. Robot físico

La personalidad, memoria y lógica principal deben ser reutilizables entre todas las plataformas.

## Principios

- Local-first.
- Sin APIs de pago como requisito.
- Privacidad por defecto.
- Acciones peligrosas requieren confirmación.
- El cerebro debe estar separado de la interfaz.
- Los dispositivos son distintos cuerpos del mismo BMO.
- Las funciones nuevas deben ser modulares.

## Hardware actual

- Apple M2
- 8 GB de memoria unificada
- macOS
- Apple Silicon arm64

## Cerebro inicial

- Ollama
- Qwen 3.5 4B
- Thinking OFF para conversación cotidiana.
- Thinking ON solamente cuando una tarea realmente requiere razonamiento.

OpenJarvis está instalado y será evaluado como capa de agentes, herramientas y memoria.
