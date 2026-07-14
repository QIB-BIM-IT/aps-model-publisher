# API vérifiée — état référence (G203 / G205 / G111)

Lecture pure des métadonnées `RevitAPI.dll` 2024 et 2025.

## Membres utilisés

| Membre | 2024 | 2025 |
|--------|------|------|
| `Element.Pinned` (get/set) | présent | présent |
| `Element.DesignOption` (get) | présent | présent |
| `Element.Name` (get) | présent | présent |
| `DesignOption.IsPrimary` (get) | présent | présent |
| `RevitLinkInstance` (OfClass) | présent | présent |
| `Level` / `Grid` (OfClass) | présent | présent |

## Deltas 2024 / 2025

Aucun sur ce périmètre.

## Sémantique retenues

- `DesignOption == null` ⇒ élément dans le **Main Model** (libellé rapport `"Main Model"`).
- Option conforme ⇒ `IsPrimary == true` **et** `Name` égal au nom attendu
  (comparaison Trim + OrdinalIgnoreCase).
- **Ambiguïté levée** : `DesignOption.Name` d'une option primaire affiche souvent
  le suffixe ` <primary>` (ex. `"Quadrillages  <primary>"`). Normalisation :
  retrait de ce suffixe avant comparaison et dans les libellés rapportés.
- `DesignOption.Name` hérité de `Element.Name` (DesignOption : Element).
- Liens : `Element.Name` de l'instance hôte — **jamais** `GetLinkDocument()`.

## Ambiguïté signalée / levée

- Suffixe ` <primary>` sur `DesignOption.Name` : normalisé (voir ci-dessus).
- Les niveaux ne peuvent pas appartenir à une design option (règle produit Revit) :
  G203 ne lit donc que `Pinned`.
