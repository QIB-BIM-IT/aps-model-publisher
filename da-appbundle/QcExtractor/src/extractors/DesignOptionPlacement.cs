using System;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// Helpers partagés G205 / G111 : détection « design option principale nommée ».
    /// API vérifiée 2024/2025 : Element.DesignOption, DesignOption.IsPrimary, Element.Name.
    ///
    /// AMBIGUÏTÉ LEVÉE : DesignOption.Name pour une option primaire renvoie souvent
    /// « Nom  &lt;primary&gt; » (suffixe Revit). On normalise en retirant ce suffixe avant
    /// comparaison / rapport. Comparaison : Trim + OrdinalIgnoreCase (aligné G210).
    /// </summary>
    internal static class DesignOptionPlacement
    {
        public const string MainModelLabel = "Main Model";
        private const string PrimarySuffix = " <primary>";

        /// <summary>Nom d'affichage sans le suffixe « &lt;primary&gt; » ajouté par l'API.</summary>
        public static string NormalizeOptionName(string nom)
        {
            if (string.IsNullOrEmpty(nom)) return string.Empty;
            string s = nom.Trim();
            if (s.EndsWith(PrimarySuffix, StringComparison.OrdinalIgnoreCase))
                s = s.Substring(0, s.Length - PrimarySuffix.Length).TrimEnd();
            return s;
        }

        public static string Label(DesignOption dop)
        {
            if (dop == null) return MainModelLabel;
            try { return NormalizeOptionName(dop.Name ?? string.Empty); }
            catch { return string.Empty; }
        }

        /// <summary>
        /// True si l'élément est dans l'option PRIMARY dont le nom (normalisé) == attendu.
        /// Sinon false + raison : "dans main model" | "option secondaire" | "mauvaise option".
        /// </summary>
        public static bool EstOptionPrincipaleAttendue(DesignOption dop, string nomAttendu, out string raison)
        {
            string attendu = NormalizeOptionName(nomAttendu ?? string.Empty);
            if (dop == null)
            {
                raison = "dans main model";
                return false;
            }
            bool primary = false;
            try { primary = dop.IsPrimary; } catch { primary = false; }
            if (!primary)
            {
                raison = "option secondaire";
                return false;
            }
            string nom = Label(dop);
            if (!string.Equals(nom, attendu, StringComparison.OrdinalIgnoreCase))
            {
                raison = "mauvaise option";
                return false;
            }
            raison = null;
            return true;
        }
    }
}
