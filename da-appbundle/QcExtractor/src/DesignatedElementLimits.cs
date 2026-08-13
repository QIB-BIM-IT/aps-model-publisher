namespace QcExtractor
{
    /// <summary>
    /// Plafond de sécurité : 50 000 éléments désignés par contrôle et par run.
    /// Ne coupe pas en usage normal ; borne un run pathologique.
    /// </summary>
    public static class DesignatedElementLimits
    {
        public const int SafetyCapPerControl = 50000;
    }
}
