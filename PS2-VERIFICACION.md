# PS2: corrección del puente Play!

## Evidencia y causa

Revisión del repositorio AVJZ30/juegossimulationweb desde `947e61350ad885b5efd5385f8c7bde8d084b9b9d`.
Fuente oficial revisada: **d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe**, que coincide con el identificador de la versión informada. No se modificaron Play.js ni Play.wasm.

Defecto confirmado: faltaba `Module.discImageDevice`. En esta build, montar el ISO en MEMFS no suministra los datos al lector nativo.

- [DiskUtils.cpp, rama Emscripten](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/Source/DiskUtils.cpp): `CreateImageStream` devuelve `CJsDiscImageDeviceStream`, sin abrir la ruta ISO por FS.
- [Js_DiscImageDeviceStream.cpp](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/Source/Js_DiscImageDeviceStream.cpp): usa `MAIN_THREAD_EM_ASM` para llamar a `Module.discImageDevice.read`, `getFileSize`, `isDone`. El hilo de VM espera la finalización de una lectura asíncrona.
- Esas cuatro llamadas están también presentes en `ASM_CONSTS` del **Play.js del usuario**, no solo en el fuente upstream.
- [PlayModule.ts](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/js/play_browser/src/PlayModule.ts): `await Play()` → crear `/work` → crear `discImageDevice` → `initVm`.
- [Actions.ts](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/js/play_browser/src/Actions.ts): ISO → `setFile(file)` y `bootDiscImage(file.name)`; ELF → FS y `bootElf`.
- [DiscImageDevice.ts](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/js/play_browser/src/DiscImageDevice.ts): `file.slice(...).arrayBuffer()` → `HEAPU8.set` → bandera de finalización.

Esto explica por qué el contador de `stream_ops.read` del ISO permanece en cero: no es la ruta usada por Play!. Es un defecto causal concreto del puente, pero **no se reprodujo el bloqueo original en un navegador**, por lo que no se afirma haber descartado un bloqueo adicional durante `Reset`/WebGL.

## Respuesta a las hipótesis

| Hipótesis | Resultado de la revisión |
|---|---|
| Deadlock de syscalls FS del ISO | El disco no usa esas syscalls. Sí hay proxy al hilo principal para el dispositivo asíncrono. No bloquear ese hilo ni esperar con Atomics.wait. No se descartan otros bloqueos sin ejecución gráfica. |
| Orden/initVm/main | Main.cpp: `main()` imprime la versión; no crea la VM. `initVm()` debe llamarse una vez tras resolver la fábrica. Se reproduce el orden oficial. No se agrega `noInitialRun`. |
| Canvas/OffscreenCanvas | Se mantiene `#outputCanvas`, 640×480 y Module.canvas. La build oficial usa OFFSCREEN_FRAMEBUFFER y WebGL2. No se transfiere arbitrariamente a OffscreenCanvas. Se trazan creación/pérdida de contexto y workers. |
| stream_ops incompleto | No es el mecanismo de lectura ISO de este binario. Se elimina ese montaje y el reintento MEMFS. |
| Ruta especial | `/work` se conserva como en upstream; para ISO se entrega el nombre y el objeto File. ELF sí se escribe en `/work`. |
| BIOS externa | [README oficial](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/README.md): usa BIOS HLE; no requiere ni admite BIOS externa. SCPH-70012.bin no corrige este problema. |

## Cambios

- **ps2.html completo:** dispositivo oficial con lectura local bajo demanda, comprobación de rango/errores, vista HEAPU8 obtenida después del await, trazas de disco/FS/WebGL/workers y contador de frames con `getFrames()` + `clearStats()` como upstream.
- **index.html completo:** conserva diseño morado e iframe; elimina reintento que cargaba todo el ISO en RAM; corrige la carrera del evento load; describe lectura local y controles; propaga errores de IndexedDB.
- **coi-sw.js y _headers:** sin cambios. GitHub Pages depende del service worker; `_headers` no configura Pages.
- **Memoria:** ya no se precarga un ISO >1 GB ni se limita artificialmente el archivo a 3 GB. Se mantiene el límite propio del heap WASM de 2 GB. El tamaño de lectura lo solicita el motor; formatos comprimidos y asignaciones internas pueden consumir memoria adicional.
- **Privacidad:** el dispositivo solo lee `File.slice`; no envía el ISO por HTTP. Los recursos del motor/interfaz sí se descargan normalmente.

## Controles

Haz clic en la pantalla. Flechas: cruceta; Z/X/A/S: cruz/círculo/cuadrado/triángulo; Enter: Start; Retroceso: Select; 1/2/3: L1/L2/L3; 8/9/0: R1/R2/R3. Stick izquierdo: F/H/T/G; derecho: J/L/I/K.

El código oficial usa `Key1` etc. para hombros, aunque los eventos reales del teclado son `Digit1` etc.; el puente los normaliza. Un mando con mapping `standard` se mapea a esas entradas; se aplica zona muerta 0,25 y se liberan teclas al perder foco/desconectar. **Los sticks son digitales simulados**, no ejes analógicos de precisión: el binario no exporta una API para ello. No se promete compatibilidad con mandos sin mapping estándar.

## Memory cards

[PS2VM.cpp](https://github.com/jpd002/Play-/blob/d44bfa1814b729d4a3ed3c6c3a945432d5ee5bbe/Source/PS2VM.cpp) configura `vfs/mc0` y `vfs/mc1` dentro de `Play Data Files`. Se descubren esas carpetas creadas por el motor; no se busca `Memorycards`.

Se restauran antes de arrancar el juego. Se comparan todos los bytes de los archivos (sin la firma muestreada anterior), se guardan cambios y eliminaciones cada 5 s, al ocultar y al detener, mediante la base existente `AVJ_RetroPlay_DB_v3`, registro `bios_store/ps2_memcards`. Los errores se muestran en el log. No requiere IDBFS.

Limitaciones: un cierre forzado puede perder los últimos cambios y un navegador puede borrar su almacenamiento. No hay garantía de finalizar una transacción al cerrar la pestaña. Las snapshots no equivalen a una pausa transaccional de la VM; no se verificó todavía un guardado real de un juego y su restauración. Se guardan archivos de las tarjetas HLE, no un volcado RAW .ps2 de 8 MB.

## Verificación realizada

- `node --test tests/ps2-device.test.cjs`: **5 pruebas aprobadas**. Lectura pequeña por encima de 4 GiB sin precarga, heap actualizado después del await, rechazo de lectura sin espera infinita, rangos/lecturas incompletas y snapshots de tarjetas (cambio de byte interior y eliminación).
- Sintaxis de los scripts de ambos HTML y de la prueba de navegador: aprobada con `node --check`.
- `git diff --check`: aprobado.
- Revisión estática contra el commit oficial exacto y las llamadas del JS entregado.

**No se verificó que getFrames aumente.** Chromium no estaba instalado y los intentos de descargarlo terminaron con un archivo inválido (`End of central directory record signature not found`). No se ejecutó Metal Slug, un ELF ni un ISO en navegador; no se certifica compatibilidad, audio, GPU, mando físico ni guardado real. Las pruebas de Node no ejecutan el emulador.

## Prueba de navegador reproducible

Desde este repositorio, con Node, un Chromium instalable y un ELF homebrew o ISO legal:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/ps2-browser.cjs /ruta/absoluta/demo.elf
node tests/ps2-browser.cjs /ruta/absoluta/juego.iso
```

El script sirve localhost sin cabeceras COOP/COEP, registra el coi-sw.js real y recarga; comprueba aislamiento, carga el archivo local y exige frames > 0 en 120 s (y lecturas > 0 para ISO). Usa SwiftShader. Un ELF solo prueba la ruta ELF; para verificar el defecto del disco es necesaria la segunda ejecución con ISO. El script pide un flush de tarjetas, pero no automatiza el guardado dentro del juego.

Para verificar tarjetas: guardar desde el menú del juego, esperar al menos 5 s, reiniciar, seleccionar el mismo juego y cargar la partida. Revisar el log si IndexedDB falla.

El diagnóstico distingue: workers creados/cargados, contexto WebGL, lecturas/pending/posición, memoria WASM y heartbeat del hilo principal. El estado interno/bloqueos de pthreads no están exportados; el log no inventa su estado.
