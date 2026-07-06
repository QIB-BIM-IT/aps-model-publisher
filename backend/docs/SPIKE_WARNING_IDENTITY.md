# SPIKE chantier 2 — identité des avertissements Revit (2026-07-06)

Question : la classification de criticité doit-elle s'ancrer sur le **Guid de définition**
(`FailureMessage.GetFailureDefinitionId().Guid`) ou sur le **texte** (`GetDescriptionText()`) ?

**Réponse : sur le Guid.** Preuves ci-dessous, obtenues par 4 workitems DA de diagnostic
(alias `spike`/`spikefr`, chaîne `+prod` intacte) avec un chemin de diagnostic optionnel
dans l'addin (drapeau `diagnostic` de params.json — le calcul G408 est inchangé : les
totaux 27 et 1 des pilotes sont reproduits à l'identique).

## Surface API vérifiée par inspection des DLLs (MetadataLoadContext, pas de mémoire)

- `FailureMessage` **identique** entre RevitAPI 24.3.40.0 et 25.4.30.0 :
  `GetFailureDefinitionId()`, `GetDescriptionText()`, `GetSeverity()`, `GetFailingElements()`,
  `GetAdditionalElements()`, `GetDefaultResolutionCaption()`, `HasResolutions()`…
- `FailureDefinitionId` hérite de `GuidEnum` → propriété **`Guid` (System.Guid)**.
- `FailureSeverity` : None=0, Warning=1, Error=2, DocumentCorruption=3 (identique 2024/2025).
- `Document.GetWarnings()` : seule méthode *Warning* du Document, signature identique.

## Runs de diagnostic (59 avertissements observés au total)

| Run | Modèle | Engine | total | Guids distincts | Guids vides | Sévérités natives |
|---|---|---|---|---|---|---|
| diag-2024-enu | MHM-TETE-…-M3-ELEC (formation) | 2024 ENU | 27 | 3 | **0/27** | Warning uniquement |
| diag-2025-enu | 52934TT_M_PR_2025 (RAIM) | 2025 ENU | 1 | 1 | **0/1** | Warning uniquement |
| diag-2024-fra | MHM-TETE-…-M3-ELEC (même modèle) | 2024 **FRA** (`/l FRA`) | 27 | 3 (**les mêmes**) | **0/27** | Warning uniquement |
| diag-2024-fede | MHM-TETE-…-M3-FEDE (autre modèle) | 2024 ENU | 4 | 2 | **0/4** | Warning uniquement |

## Agrégations par Guid

ELEC 2024 (ENU) :
- `6e1efefe-c8e0-483d-8482-150b9f1da21a` ×21 — 2 textes : « duplicate "Number" values » ET « duplicate "Mark" values »
- `ce3275c6-1c51-402e-8de3-df3a3d566f5c` ×2 — « Space is not in a properly enclosed region »
- `9ce8825a-7718-4533-af93-194b475f9008` ×4 — « Multiple Spaces are in the same enclosed region… »

RAIM 2025 : `b4176cef-6086-45a8-a066-c3fd424c9412` ×1 — « identical instances in the same place »
(doublon d'instances, avertissement Revit intégré : Guid présent et non vide).

FEDE 2024 : `6e1efefe…` ×2 et `ce3275c6…` ×2 — **mêmes Guids que l'ELEC** pour les mêmes types.

ELEC 2024 en FRANÇAIS : mêmes 3 Guids, mêmes comptes (21/2/4), textes localisés
(« Les éléments ont des valeurs "Numéro" dupliquées. », « …"Identifiant" dupliquées. », etc.).

## Réponses aux 4 questions

1. **Guid présent et non vide partout ?** OUI — 59/59 avertissements, y compris le doublon
   d'instances intégré. Aucun `Guid.Empty`, aucun `GetFailureDefinitionId()` null.
2. **Même type ⇒ même Guid entre modèles ?** OUI — ELEC et FEDE (deux modèles distincts)
   partagent `6e1efefe…` (valeurs dupliquées) et `ce3275c6…` (espace non fermé).
3. **Sévérité native toujours Warning ?** OUI — 59/59 = `Warning`. `GetWarnings()` ne remonte
   pas d'Error : la sévérité native est **inutilisable** pour classer High/moyen/ignorable.
4. **Modèle français ?** Aucun modèle édité en Revit FR n'était désigné — mais l'expérience
   est plus forte : **la langue des textes dépend du MOTEUR, pas du modèle** (activity avec
   `/l FRA` sur le même modèle : mêmes Guids, mêmes comptes, textes français). Preuve par
   l'absurde en prime : nos patterns textuels de la tranche 1 donnent **critical=0 en
   français vs 21 en anglais** sur les mêmes 27 avertissements — le texte est disqualifié.

## Nuance de granularité à garder pour la conception

Le Guid est PLUS GROSSIER que le texte : `6e1efefe…` couvre à la fois « Number » et « Mark »
dupliqués. Une grille de criticité ancrée Guid devra prévoir un raffinement optionnel
(pattern sur le texte à l'INTÉRIEUR d'un Guid) pour les cas où l'on veut distinguer.
La clé de config par projet reste : **Guid d'abord, texte en second niveau optionnel**.

## Notes d'exécution

- Le `/l FRA` DA fonctionne mais la commandLine doit garder son double backslash
  (`$(engine.path)\\revitcoreconsole.exe … /l FRA`) — un échappement perdu produit
  « Error: 'Exe' is a directory ».
- Alias DA `spike` / `spikefr` créés sur les activities/appbundles existants ; les alias
  `+prod` n'ont pas bougé. Nickname jamais touché. Base locale uniquement.
