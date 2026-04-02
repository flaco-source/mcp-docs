# Investigación: proveedor STMicroelectronics (ST) — fase de análisis

Documento de trabajo para la implementación del proveedor `ST` en el MCP de documentación electrónica.  
**Fecha de referencia:** 2026-04-02  
**URL de partida analizada:** [STM32G071RB — overview](https://www.st.com/en/microcontrollers-microprocessors/stm32g071rb.html#overview)

---

## 1. Objetivo en el código

- Nuevo `StMicroelectronicsProvider` con `vendorId: 'ST'` (o `STM32` si se prefiere granularidad; lo habitual es **`ST`**).
- Implementar `searchDocs`, `readDoc`, `queryContent`, y opcionalmente `lookupDoc` / `getDocumentPageText` siguiendo el patrón de `TexasInstrumentsProvider`.
- Reutilizar el índice SQLite existente (`documents.vendor`, `chunks` FTS5).

---

## 2. Estructura de la página de producto ST

### 2.1 Patrón de URL (MCU / producto)

Ejemplo real:

```text
https://www.st.com/en/microcontrollers-microprocessors/stm32g071rb.html
```

Observaciones:

- Esquema: `https://www.st.com/en/<categoría>/<slug-del-producto>.html`
- El **slug** suele ser el **ordering code en minúsculas** (p. ej. `stm32g071rb`).
- El fragmento `#overview` / `#documentation` es solo ancla del cliente; la misma respuesta HTML puede servir para varias pestañas.

### 2.2 Contenido visible en HTML estático (fetch sin JS)

En la respuesta obtenida para la página del STM32G071RB aparece:

- Título comercial y estado del producto.
- Enlace explícito al **datasheet** en primera plana:

```text
https://www.st.com/resource/en/datasheet/stm32g071rb.pdf
```

- Secciones de navegación: *Overview*, *Sample & Buy*, *Solutions*, **Documentation**, *CAD Resources*, *Tools & Software*, *Quality & Reliability*, etc.
- Bloque “Search documents by title” con filtros *File Type: PDF | ZIP* y “Latest update” (interfaz tipo portal de documentos).
- En “All resources”: enlaces a **ZIP** (p. ej. SVD, IBIS), rutas bajo `/resource/en/svd/`, `/resource/en/ibis_model/`.
- PDFs de **material declaration** bajo `/resource/en/material_declaration/...` (menos relevantes para desarrollo de firmware).

### 2.3 Riesgo: contenido cargado por JavaScript

Muchas listas completas de documentos (RM, UM, errata, app notes) en la pestaña **Documentation** pueden **no** estar en el HTML inicial y cargarse vía **XHR/API en el navegador**. Implicaciones:

- Un simple `axios.get` + `cheerio` puede **no** ver todos los PDFs que ve el usuario en el navegador.
- **Mitigación en código:** además del HTML (producto + página de serie, en paralelo), el proveedor ST llama en paralelo a `GET https://www.st.com/bin/st/search/resources?q=<parte>&limit=80&start=0` (referencia en la comunidad ST), serializa el JSON y extrae URLs absolutas y rutas relativas `/resource/en/…/*.pdf` (también host `content.st.com` si aparece). Primero se filtran por slug / línea STM32; si el JSON es grande pero ningún PDF pasa el filtro, se toman hasta ~45 enlaces sin filtro (la `q=` ya acota). Si no hay respuesta, en stderr: `DEBUG [ST]: bin/st/search/resources returned no data…`.
- Sigue pudiendo haber diferencias vs la UI si ST cambia el JSON o el buscador ordena distinto.

---

## 3. Patrones de URL de recursos (PDF / documentos técnicos)

### 3.1 Datasheet

Patrón observado:

```text
https://www.st.com/resource/en/datasheet/<identificador>.pdf
```

Ejemplo:

```text
https://www.st.com/resource/en/datasheet/stm32g071rb.pdf
```

El identificador suele coincidir con el **nombre del producto en minúsculas** (no siempre trivial para todos los encapsulados).

### 3.2 Reference manual (familia / serie)

Patrón general (confirmado por búsqueda pública para RM0444 / STM32G0x1):

```text
https://www.st.com/resource/en/reference_manual/<slug-descriptivo>.pdf
```

Ejemplos reales (mismo documento, slugs distintos):

```text
https://www.st.com/resource/en/reference_manual/rm0444-stm32g0x1-advanced-armbased-32bit-mcus-stmicroelectronics.pdf
https://www.st.com/resource/en/reference_manual/dm00371828-stm32g0x1-advanced-armbased-32bit-mcus-stmicroelectronics.pdf
```

Observaciones:

- Puede existir **más de una URL** para el mismo PDF (prefijo `rmNNNN` vs `dmXXXXXXXX`).
- Para **search/index**: normalizar por URL canónica al guardar en BD o por hash del PDF (fase posterior).

### 3.3 Otras rutas bajo `/resource/en/`

| Subruta (ejemplos) | Uso típico |
|--------------------|------------|
| `datasheet/` | Datasheet del dispositivo |
| `reference_manual/` | RM |
| `user_manual/` | User manuals (común en eval boards) |
| `application_note/` | Application notes |
| `programming_manual/` | PM |
| `svd/`, `ibis_model/` | SVD, IBIS (ZIP) |
| `material_declaration/` | Cumplimiento / medio ambiente (a menudo irrelevante para SW embebido) |

Para el MCP, conviene **filtrar por extensión y tipo**: priorizar `.pdf` de `datasheet`, `reference_manual`, `application_note`, `programming_manual`; excluir o bajar prioridad a `material_declaration` salvo que el usuario lo pida.

### 3.4 Página de documentación de serie (familia)

Existe documentación agregada por familia, p. ej.:

```text
https://www.st.com/en/microcontrollers-microprocessors/stm32g0-series/documentation.html
```

Útil como **segunda fuente** si la página del part individual no lista el RM completo en HTML estático. (Nota: fetch directo a esta URL puede ser lento o timeout en entornos automatizados; reintentar o usar User-Agent de navegador.)

---

## 4. Mapeo a `SearchResult['type']` (propuesta)

| Origen / título contiene | Tipo interno sugerido |
|--------------------------|------------------------|
| Datasheet, “data sheet” | `datasheet` |
| Reference manual, RMxxxx | `user_guide` (o tipo dedicado si se amplía el esquema) |
| Programming manual | `user_guide` o `other` |
| Application note, ANxxxx | `application_note` |
| Errata | `errata` |
| Material declaration, Ecopack | `other` (filtrar por defecto) |

---

## 5. Estrategia propuesta para `searchDocs(query)` (borrador)

1. **Normalizar `query`**: trim, mayúsculas opcionales → slug de producto ST (p. ej. `STM32G071RB` → `stm32g071rb`).
2. **Construir URL de producto** si el usuario pasó un ordering code conocido:
   - Opción A: plantilla por categoría (MCU → `.../microcontrollers-microprocessors/<slug>.html`) — **requiere** saber la categoría o asumir una por defecto y manejar 404.
   - Opción B: usar **búsqueda ST** (si hay endpoint estable) y seguir el primer resultado — a investigar.
3. **Descargar HTML** de la página de producto con `User-Agent` de navegador y timeout generoso.
4. **Extraer enlaces** `href` que coincidan con:
   - `https://www.st.com/resource/en/[^"']+\.pdf`
   - Filtrar exclusiones (material_declaration si se desea).
5. **Si la lista es pobre**, segunda pasada: página `.../<serie>-series/documentation.html` derivada del part (p. ej. `stm32g0` desde `stm32g071rb`) — definir reglas heurísticas por familia STM32.
6. **Metadata en caché**: `insertDocument(vendor, part, title, docType, url)` con `part` = ordering code normalizado.

### 5.1 Datasheet por convención (fallback rápido)

Si se conoce el nombre de producto en minúsculas:

```text
https://www.st.com/resource/en/datasheet/<slug>.pdf
```

Validar con **HEAD** o GET parcial antes de indexar (evitar 404).

---

## 6. `readDoc` / descarga PDF

- Misma pila que TI: **HTTPS GET** → buffer → **pdfjs** → `indexChunks`.
- ST puede servir PDFs con **redirecciones**; seguir redirects (axios `maxRedirects`).
- Probar **Accept: application/pdf** (como en TI).
- **Normalización de URL** para `findDocumentByUrl`: además de quitar query string, contemplar variantes `rmXXXX` vs `dmXXXXXXXX` si se deduplican documentos.

---

## 7. `queryContent` / `lookupDoc`

- `queryContent`: sin cambios de diseño; filtrar `vendor = 'ST'`.
- `lookupDoc`: copiar flujo TI (consultar índice → si vacío, `searchDocs` → ordenar por heurística → `readDoc` hasta N documentos → volver a buscar).

Heurística sugerida para STM32:

- Pregunta con “register”, “peripheral”, “RCC”, “GPIO”, “memory map” → priorizar **reference_manual**, luego **datasheet**.
- Pregunta con “electrical”, “pin”, “package” → priorizar **datasheet**.

---

## 8. Limitaciones y cumplimiento

- **Términos de uso** de st.com: revisar robots/ToS antes de scraping intensivo.
- **Rate limiting**: espaciar peticiones; reintentos con backoff.
- **Cookies / geo**: si aparecen 403 o páginas vacías, evaluar cabeceras adicionales o sesión (solo si es imprescindible).

---

## 9. Checklist para la siguiente fase (desarrollo)

- [x] Prototipo `searchDocs('STM32G071RB')` con axios + cheerio sobre la URL de producto fija (`microcontrollers-microprocessors/<slug>.html`).
- [ ] Listar enlaces PDF encontrados vs lista manual en el navegador (pestaña Documentation).
- [ ] Si falta RM en HTML, localizar API XHR o usar URL de familia `.../stm32g0-series/documentation.html`.
- [x] Implementar `StMicroelectronicsProvider` y registrar en `index.ts`.
- [ ] Tests manuales completos: `read_electronics_doc` con datasheet y RM; `query_doc_content`; `read_electronics_doc_page` (v0: `readDoc`/`queryContent` listos; `lookupDoc` / `getDocumentPageText` siguen sin override para ST).
- [ ] Actualizar guía MCP (`tool-usage-guide.md`) con `vendor: 'ST'` y particularidades.

---

## 10. Referencias rápidas (STM32G071RB)

| Recurso | URL ejemplo |
|---------|-------------|
| Página producto | `https://www.st.com/en/microcontrollers-microprocessors/stm32g071rb.html` |
| Datasheet (PDF) | `https://www.st.com/resource/en/datasheet/stm32g071rb.pdf` |
| RM0444 (STM32G0x1) | `https://www.st.com/resource/en/reference_manual/rm0444-stm32g0x1-advanced-armbased-32bit-mcus-stmicroelectronics.pdf` |
| Doc serie STM32G0 | `https://www.st.com/en/microcontrollers-microprocessors/stm32g0-series/documentation.html` |

---

## 11. Implementación v0 (estado en código)

**Incluido:**

- `StMicroelectronicsProvider` (`vendorId: 'ST'`): `searchDocs` raspa **en paralelo** la página del producto y la de documentación de serie (timeout corto por petición; tiempo total ≈ el de la más lenta, no la suma). Se fusionan enlaces del HTML + **PDFs conocidos por familia** (`ST_SERIES_KNOWN_PDFS`, p. ej. RM0444 para `stm32g0-series`) cuando el portal no expone PDFs en HTML estático, más fallback de datasheet. Se **unen** filas ya guardadas en SQLite para ese `part` que no salieron del scrape. Cada ítem lleva `cached` según si la URL ya existía para `vendor = ST` antes del `insertDocument` de esa llamada; `readDoc` + `queryContent` como antes.
- Registro en el servidor MCP junto a TI; herramientas primitivas aceptan `vendor: 'ST'`.
- Utilidades compartidas en `src/providers/pdfExtract.ts` (TI refactorizado para usarlas).
- Script manual: `npm run test:st-search` → `scripts/test-st-search-docs.ts` (prueba `searchDocs('STM32G071RB')`).

**Limitaciones conocidas:**

- Solo categoría de producto **MCU** en la URL base (`…/microcontrollers-microprocessors/<slug>.html`); otros productos ST pueden requerir otra plantilla.
- La pestaña **Documentation** puede cargar PDFs vía **JavaScript**; la lista obtenida puede ser un subconjunto de la visible en el navegador.
- `lookup_electronics_doc` y `read_electronics_doc_page` **no** están implementados para ST en v0 (heredan el default que indica no soportado / mismatch).

**Siguiente paso sugerido:** si aún faltan PDFs respecto al navegador, inspeccionar en DevTools las llamadas XHR/fetch del portal ST y valorar un cliente a esa API (estabilidad y ToS).

---

*Este archivo es nota interna de proyecto; no sustituye el cumplimiento legal ni la estabilidad de las URLs de terceros.*
