import React from 'react';
import { fieldBox, labelStyle, aideStyle } from './widgetStyles';

/** Cadre commun : libellé + aide autour du champ du widget. */
export default function WidgetChrome({ descriptionCible, children }) {
  const libelle = descriptionCible?.libelle || '';
  const aide = descriptionCible?.aide || '';
  return (
    <div style={fieldBox}>
      {libelle ? <label style={labelStyle}>{libelle}</label> : null}
      {aide ? <span style={aideStyle}>{aide}</span> : null}
      {children}
    </div>
  );
}
