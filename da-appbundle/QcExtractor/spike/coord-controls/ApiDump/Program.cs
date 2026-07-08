// Vérification d'API — lot COORDONNÉES (G104/G105/G200/G201/G202).
// Dumpe TOUS les membres publics (méthodes, propriétés, champs) des types demandés,
// avec leurs signatures exactes, par lecture PURE des métadonnées de RevitAPI.dll.
// Aucun assembly Autodesk n'est chargé, aucun code Revit n'est exécuté.
//
// Usage : dotnet run --project ApiDump -- "<chemin RevitAPI.dll>" Type1 Type2 ...

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection;
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
            Console.WriteLine("Usage: ApiDump <RevitAPI.dll> <TypeSimpleName> [<TypeSimpleName> ...]");
            return;
        }
        var dll = args[0];
        var wanted = new HashSet<string>(args.Skip(1), StringComparer.Ordinal);
        var provider = new NameProvider();

        using var fs = File.OpenRead(dll);
        using var pe = new PEReader(fs);
        var md = pe.GetMetadataReader();

        Console.WriteLine("=== " + dll + " ===");
        foreach (var th in md.TypeDefinitions)
        {
            var t = md.GetTypeDefinition(th);
            var name = md.GetString(t.Name);
            if (!wanted.Contains(name)) continue;
            var ns = md.GetString(t.Namespace);
            Console.WriteLine("--- " + (string.IsNullOrEmpty(ns) ? name : ns + "." + name) + " ---");

            // Méthodes publiques (signature complète)
            foreach (var mh in t.GetMethods())
            {
                var m = md.GetMethodDefinition(mh);
                var mn = md.GetString(m.Name);
                var attrs = m.Attributes;
                bool isPublic = (attrs & MethodAttributes.MemberAccessMask) == MethodAttributes.Public;
                if (!isPublic) continue;
                bool isStatic = (attrs & MethodAttributes.Static) != 0;
                MethodSignature<string> sig;
                try { sig = m.DecodeSignature(provider, null); }
                catch { continue; }
                var ps = string.Join(", ", sig.ParameterTypes);
                Console.WriteLine($"  M {(isStatic ? "static " : "")}{sig.ReturnType} {mn}({ps})");
            }

            // Propriétés (type de retour du getter)
            foreach (var ph in t.GetProperties())
            {
                var p = md.GetPropertyDefinition(ph);
                var pn = md.GetString(p.Name);
                string rt = "?";
                try { rt = p.DecodeSignature(provider, null).ReturnType; }
                catch { }
                Console.WriteLine($"  P {rt} {pn}");
            }

            // Champs publics (les static ForgeTypeId de SpecTypeId/UnitTypeId en sont)
            foreach (var fh in t.GetFields())
            {
                var f = md.GetFieldDefinition(fh);
                var fa = f.Attributes;
                bool isPublic = (fa & FieldAttributes.FieldAccessMask) == FieldAttributes.Public;
                if (!isPublic) continue;
                bool isStatic = (fa & FieldAttributes.Static) != 0;
                var fn = md.GetString(f.Name);
                string ft = "?";
                try { ft = f.DecodeSignature(provider, null); }
                catch { }
                Console.WriteLine($"  F {(isStatic ? "static " : "")}{ft} {fn}");
            }
        }
    }
}
