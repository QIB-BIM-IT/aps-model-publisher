// SPIKE (branche spike/qc-coordination-review, NON destinée au merge).
// Décode les signatures EXACTES (types de retour + paramètres) de méthodes ciblées
// dans RevitAPI.dll, par lecture PURE des métadonnées. Aucun assembly n'est chargé,
// aucun code Revit n'est exécuté : on lit le blob de signature et on le rend en
// texte via un ISignatureTypeProvider. Sert de preuve d'API vérifiée 2024 ET 2025.
//
// Usage : dotnet run --project SigDump -- "<chemin RevitAPI.dll>" Type1 Type2 ...

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

class NameProvider : ISignatureTypeProvider<string, object>
{
    public string GetArrayType(string e, ArrayShape s) => e + "[]";
    public string GetByReferenceType(string e) => "ref " + e;
    public string GetPointerType(string e) => e + "*";
    public string GetGenericInstantiation(string g, ImmutableArray<string> a) => g + "<" + string.Join(",", a) + ">";
    public string GetGenericMethodParameter(object c, int i) => "!!" + i;
    public string GetGenericTypeParameter(object c, int i) => "!" + i;
    public string GetModifiedType(string m, string u, bool r) => u;
    public string GetPinnedType(string e) => e;
    public string GetSZArrayType(string e) => e + "[]";
    public string GetPrimitiveType(PrimitiveTypeCode c) => c.ToString();
    public string GetFunctionPointerType(MethodSignature<string> s) => "fnptr";

    public string GetTypeFromDefinition(MetadataReader r, TypeDefinitionHandle h, byte rawKind)
    {
        var t = r.GetTypeDefinition(h);
        var ns = r.GetString(t.Namespace);
        var n = r.GetString(t.Name);
        return string.IsNullOrEmpty(ns) ? n : ns + "." + n;
    }
    public string GetTypeFromReference(MetadataReader r, TypeReferenceHandle h, byte rawKind)
    {
        var t = r.GetTypeReference(h);
        var ns = r.GetString(t.Namespace);
        var n = r.GetString(t.Name);
        return string.IsNullOrEmpty(ns) ? n : ns + "." + n;
    }
    public string GetTypeFromSpecification(MetadataReader r, object c, TypeSpecificationHandle h, byte rawKind)
        => r.GetTypeSpecification(h).DecodeSignature(this, c);
}

class Program
{
    static void Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.WriteLine("Usage: SigDump <RevitAPI.dll> <TypeSimpleName> [<TypeSimpleName> ...]");
            return;
        }
        var dll = args[0];
        var wanted = new HashSet<string>(args.Skip(1), StringComparer.Ordinal);

        using var fs = File.OpenRead(dll);
        using var pe = new PEReader(fs);
        var md = pe.GetMetadataReader();
        var provider = new NameProvider();

        Console.WriteLine("=== " + dll + " ===");
        foreach (var th in md.TypeDefinitions)
        {
            var t = md.GetTypeDefinition(th);
            var name = md.GetString(t.Name);
            if (!wanted.Contains(name)) continue;
            var ns = md.GetString(t.Namespace);
            Console.WriteLine("--- " + (string.IsNullOrEmpty(ns) ? name : ns + "." + name) + " ---");

            foreach (var mh in t.GetMethods())
            {
                var m = md.GetMethodDefinition(mh);
                var mn = md.GetString(m.Name);
                var attrs = m.Attributes;
                bool isPublic = (attrs & System.Reflection.MethodAttributes.MemberAccessMask) == System.Reflection.MethodAttributes.Public;
                if (!isPublic) continue;
                // Ne garder que les membres pertinents pour le spike
                if (!(mn.Contains("Monitor") || mn.Contains("Link") || mn.Contains("Coordinat")
                      || mn == "GetLinkedFileStatus" || mn == "IsLoaded")) continue;

                MethodSignature<string> sig;
                try { sig = m.DecodeSignature(provider, null); }
                catch { continue; }
                var ps = string.Join(", ", sig.ParameterTypes);
                Console.WriteLine($"  {sig.ReturnType} {mn}({ps})");
            }
        }
    }
}
