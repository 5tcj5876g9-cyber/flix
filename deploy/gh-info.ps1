Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CredReader {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr credential);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CRED {
        public int Flags;
        public int Type;
        public string Target;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int BlobSize;
        public IntPtr Blob;
        public int Persist;
        public int AttrCount;
        public IntPtr Attr;
        public string Alias;
        public string User;
    }

    public static string Read(string target) {
        IntPtr handle;
        if (!CredRead(target, 1, 0, out handle)) return null;
        try {
            CRED cred = (CRED)Marshal.PtrToStructure(handle, typeof(CRED));
            if (cred.BlobSize == 0) return null;
            byte[] bytes = new byte[cred.BlobSize];
            Marshal.Copy(cred.Blob, bytes, 0, cred.BlobSize);
            string utf16 = System.Text.Encoding.Unicode.GetString(bytes).TrimEnd((char)0);
            if (utf16.Length >= 20) return utf16;
            return System.Text.Encoding.UTF8.GetString(bytes).TrimEnd((char)0);
        } finally {
            CredFree(handle);
        }
    }
}
"@

$env:GH_TOKEN = [CredReader]::Read('git:https://5tcj5876g9-cyber@github.com')
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$user = gh api user | ConvertFrom-Json
Write-Output ('token-account=' + $user.login + ' type=' + $user.type)

$repo = gh api repos/5tcj5876g9-cyber/flix | ConvertFrom-Json
Write-Output ('repo=' + $repo.full_name + ' private=' + $repo.private + ' owner=' + $repo.owner.login + ' default=' + $repo.default_branch)

$count = gh api repos/5tcj5876g9-cyber/flix/commits | ConvertFrom-Json
Write-Output ('commits=' + $count.Count + ' latest=' + $count[0].sha.Substring(0, 7) + ' ' + $count[0].commit.message.Split("`n")[0])
