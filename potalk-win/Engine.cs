using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Potalker;

/// <summary>通話の仕組み（potalk.app のページ）を動かす、画面に出ない WebView2。</summary>
public sealed class Engine
{
    public static readonly Uri Home = new("https://potalk.app/");

    public JsonElement Lobby = J.Empty, Profile = J.Empty, Room = J.Empty, Cards = J.Empty;
    public string Eq = "";
    public bool Ready, Patched;

    public event Action OnLobby, OnProfile, OnRoom, OnEq, OnReady, OnCards;
    public event Action<JsonElement> OnChat, OnReact;
    public Action<string> Log = _ => { };

    Window host;
    WebView2 wv;
    readonly HttpClient http = new();

    public bool Joined => Room.B("joined");

    static string Res(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Potalker.Assets." + name);
        using var r = new StreamReader(s, Encoding.UTF8);
        return r.ReadToEnd();
    }

    public async Task StartAsync()
    {
        wv = new WebView2();
        host = new Window
        {
            Width = 900, Height = 700, Left = -20000, Top = -20000,
            WindowStyle = WindowStyle.None, ShowInTaskbar = false, ShowActivated = false, Content = wv,
        };
        host.SourceInitialized += (_, _) =>
        {   // Alt+Tab に出さない・前面に出ない
            var h = new WindowInteropHelper(host).Handle;
            SetWindowLong(h, -20, GetWindowLong(h, -20) | 0x80 | 0x08000000);
        };
        host.Show();

        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Potalker", "WebView2");
        var opts = new CoreWebView2EnvironmentOptions("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required");
        var env = await CoreWebView2Environment.CreateAsync(null, dir, opts);
        await wv.EnsureCoreWebView2Async(env);
        var c = wv.CoreWebView2;
        await c.AddScriptToExecuteOnDocumentCreatedAsync(Res("mic.js"));
        await c.AddScriptToExecuteOnDocumentCreatedAsync(Res("bridge.js"));
        c.AddWebResourceRequestedFilter("https://potalk.app/*", CoreWebView2WebResourceContext.Document);
        c.WebResourceRequested += OnRequest;
        c.WebMessageReceived += OnMessage;
        c.PermissionRequested += (_, e) =>
        {
            var okKind = e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.ClipboardRead;
            e.State = okKind && new Uri(e.Uri).Host == "potalk.app" ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        c.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        c.NavigationStarting += (_, e) =>
        {
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "potalk.app" && e.IsUserInitiated)
            { e.Cancel = true; OpenExternal(e.Uri); }
        };
        c.ScriptDialogOpening += (_, e) => e.Accept();
        c.ProcessFailed += (_, e) =>
        {
            Log("ページの描画プロセスが落ちました: " + e.ProcessFailedKind);
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            { Ready = false; c.Reload(); }
        };
        c.Navigate(Home.ToString());
    }

    public static void OpenExternal(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https"))
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    /// <summary>potalk.app の本体ページだけを取りに行って、小さな差し込みを当てて返す（ほかの通信はそのまま）。</summary>
    async void OnRequest(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (e.Request.Method != "GET") return;
        var path = new Uri(e.Request.Uri).AbsolutePath;
        if (path != "/" && path != "/index.html") return;
        var d = e.GetDeferral();
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Home);
            req.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
            using var res = await http.SendAsync(req);
            var html = await res.Content.ReadAsStringAsync();
            var (outHtml, ok, missing) = PagePatcher.Apply(html);
            Patched = ok;
            if (!ok) Log("差し込み位置が見つかりません。元のページを使います: " + missing);
            var bytes = Encoding.UTF8.GetBytes(outHtml);
            e.Response = wv.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK",
                "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
        }
        catch (Exception ex) { Log("ページの取得に失敗: " + ex.Message); }
        finally { d.Complete(); }
    }

    // ---- ページからの知らせ ----
    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement msg;
        try { msg = JsonDocument.Parse(e.WebMessageAsJson).RootElement; } catch { return; }
        var d = msg.P("d").Clone();
        switch (msg.S("t"))
        {
            case "lobby": Lobby = d; OnLobby?.Invoke(); break;
            case "profile": Profile = d; OnProfile?.Invoke(); break;
            case "room": Room = d; OnRoom?.Invoke(); break;
            case "cards": Cards = d; OnCards?.Invoke(); break;
            case "eq": Eq = d.ValueKind == JsonValueKind.String ? d.GetString() : ""; OnEq?.Invoke(); break;
            case "chat": OnChat?.Invoke(d); break;
            case "react": OnReact?.Invoke(d); break;
            case "ready": Ready = true; OnReady?.Invoke(); break;
        }
    }

    // ---- 指示 ----
    public void Cmd(object dict)
    {
        if (wv?.CoreWebView2 == null) return;
        _ = wv.CoreWebView2.ExecuteScriptAsync("window.__pm && window.__pm.cmd(" + JsonSerializer.Serialize(dict) + ")");
    }

    /// <summary>部屋のリンクで入る：そのリンクでページを読み込み直し、入口案内の「このまま入ってみる」を押す</summary>
    public async void OpenLink(string text)
    {
        var i = text.IndexOf("#room=", StringComparison.Ordinal);
        if (i < 0) return;
        var hash = text[i..].Split(' ', '\n', '\r')[0];
        Ready = false;
        wv.CoreWebView2.Navigate(Home + hash);
        for (int n = 0; n < 20 && !Joined; n++) { await Task.Delay(500); Cmd(new { type = "entryTry" }); }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
}
