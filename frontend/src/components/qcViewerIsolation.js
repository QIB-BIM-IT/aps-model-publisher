export function isolationUnavailableMessage(row) {
  const kind = row?.kind;
  if (kind === 'view') {
    return 'Cette ligne désigne une vue : elle n’est pas un objet isolable dans la maquette 3D.';
  }
  if (kind === 'family' || kind === 'type') {
    return 'Cette ligne désigne une famille ou un type, pas une occurrence 3D isolable.';
  }
  if (kind === 'option' || kind === 'workset' || kind === 'phase' || kind === 'parameter' || kind === 'name') {
    return 'Cet objet n’a pas d’identité 3D dans la maquette (variante, sous-projet, phase ou paramètre). L’isolation n’est pas disponible.';
  }
  return 'Cet objet n’a pas d’identité 3D dans la maquette. L’isolation n’est pas disponible.';
}

export function notFoundMessage(row) {
  const kind = row?.kind;
  if (kind === 'view') {
    return 'Cette vue n’apparaît pas comme un objet dans la maquette 3D.';
  }
  if (kind === 'family' || kind === 'type') {
    return 'Cette famille ou ce type n’apparaît pas comme un objet dans la maquette 3D.';
  }
  return 'Cet élément n’a pas été trouvé dans la maquette affichée (supprimé, ou vue 3D différente de l’extraction).';
}

export function sameAccModel(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}
