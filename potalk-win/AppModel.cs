using System;
using System.Collections.Generic;
using System.Linq;
using System.Media;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Windows.Devices.Enumeration;

namespace Potalker;

public sealed class AppModel
{
    public readonly Engine E = new();
    public readonly Settings S = Settings.Load();

    public MainWindow Main;
    public RoomWindow Room;
    public ChatWindow Chat;
    public SettingsWindow Sett;
    public ProfileWindow Prof;
    public MailWindow Mail;
    public LetterWindow Letter;
    public CardEditWindow CardEdit;
    public CardAuthWindow CardAuth;
    public bool MailOpen;
    string lastLetter = "", letterDismissed = "";
    public bool ForceClose;
    public bool PinRoom = true;

    public readonly List<ChatLine> ChatLines = new(), Past = new();
    public int Unread;
    public bool ChatOpen;
    public List<string> Mics = new();
    public event Action ChatChanged, MicsChanged;
    public event Action<string, string, bool> Fly;      // 絵文字, 名前, 自分

    (DateTime at, bool target)? pendingMute;
    readonly HashSet<string> seenRooms = new();
    bool armed, wasJoined;
    int lastHands;
    System.Windows.Forms.NotifyIcon tray;

    public void Start()
    {
        tray = new System.Windows.Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Visible = true, Text = "Potalker" };
        tray.BalloonTipClicked += (_, _) => { Main?.Show(); Main?.Activate(); };
        Application.Current.Exit += (_, _) => { tray.Visible = false; tray.Dispose(); };

        E.Log = s => System.Diagnostics.Debug.WriteLine(s);
        E.OnChat += l => ReceiveChat(l);
        E.OnReact += r => Fly?.Invoke(r.S("e"), r.S("u") == "self" ? "" : r.S("n"), r.S("u") == "self");
        E.OnRoom += RoomChanged;
        E.OnLobby += LobbyChanged;
        E.OnCards += CardsChanged;
        E.OnReady += () =>
        {
            E.Cmd(new { type = "setMicLabel", label = S.MicLabel });
            E.Cmd(new { type = "sndRoom", on = false });   // 通知はこちらで一本化する（ページの音は使わない）
            Task.Delay(5000).ContinueWith(_ => Application.Current.Dispatcher.Invoke(() => armed = true));
        };
        _ = RefreshMics();
    }

    // ---- 受け取り ----
    void ReceiveChat(JsonElement l)
    {
        var c = new ChatLine { Sys = l.B("sys"), Hist = l.B("hist"), Em = l.S("em"), Who = l.S("who"), Text = l.S("text") };
        if (c.Hist || (c.Sys && c.Text.StartsWith("ここから過去ログ"))) Past.Add(c);
        else
        {
            ChatLines.Add(c); if (ChatLines.Count > 200) ChatLines.RemoveAt(0);
            if (!ChatOpen && !c.Sys && !c.Who.Contains("（あなた）")) Unread++;
        }
        ChatChanged?.Invoke();
    }

    void RoomChanged()
    {
        var r = E.Room;
        bool joined = r.B("joined");
        if (joined != wasJoined)
        {
            wasJoined = joined;
            if (joined) OpenRoom(); else CloseRoomGroup();
        }
        if (!joined) return;
        // 作成・入室の直後は、設定に合わせてミュートにそろえる（マイクが取れて操作できるようになってから1回だけ）
        if (pendingMute is { } p)
        {
            if ((DateTime.Now - p.at).TotalSeconds > 15) pendingMute = null;
            else if (r.B("canMute")) { pendingMute = null; if (r.B("muted") != p.target) E.Cmd(new { type = "mute" }); }
        }
        // 配信者側：手が挙がったら音
        int hands = r.A("members").Count(m => m.S("mark") == "🙋");
        if (hands > lastHands) SystemSounds.Asterisk.Play();
        lastHands = hands;
        Room?.Refresh();
        Sett?.Refresh();
        Mail?.Refresh();
        // 公開されたお便り
        var mn = r.P("mailNow");
        var key = mn.Has() ? $"{mn.S("cap")}|{mn.S("who")}|{mn.S("text")}" : "";
        if (key.Length == 0) { lastLetter = ""; letterDismissed = ""; Letter?.Close(); }
        else
        {
            lastLetter = key;
            if (Letter != null) Letter.Refresh();
            else if (key != letterDismissed) { Letter = new LetterWindow(this); Letter.Show(); }
        }
    }

    public void RoomWindowRefresh() => Room?.Refresh();
    public void LetterClosed() { letterDismissed = lastLetter; Letter = null; }

    void CardsChanged()
    {
        var c = E.Cards;
        if (c.P("edit").Has() && CardEdit == null) { CardEdit = new CardEditWindow(this); CardEdit.Show(); }
        else if (!c.P("edit").Has() && CardEdit != null) { var w = CardEdit; CardEdit = null; w.Close(); }
        CardEdit?.Refresh();
        if (c.P("auth").Has() && CardAuth == null) { CardAuth = new CardAuthWindow(this); CardAuth.Show(); }
        else if (!c.P("auth").Has() && CardAuth != null) { var w = CardAuth; CardAuth = null; w.Close(); }
        CardAuth?.Refresh();
    }

    public void OpenMail()
    {
        MailOpen = true;
        if (Mail == null) { Mail = new MailWindow(this); Mail.Show(); } else Mail.Activate();
        Room?.Refresh();
    }

    void LobbyChanged()
    {
        foreach (var room in E.Lobby.A("rooms"))
        {
            var key = room.S("id") is { Length: > 0 } id ? id : room.S("name");
            if (seenRooms.Add(key) && armed && S.NotifyRooms)
            {
                SystemSounds.Asterisk.Play();
                tray.ShowBalloonTip(4000, "新しい部屋ができました", room.S("name"), System.Windows.Forms.ToolTipIcon.Info);
            }
        }
        Main?.RefreshLobby();
    }

    // ---- 指示 ----
    public void Join(string id, bool quiet)
    {
        pendingMute = (DateTime.Now, S.MuteOnJoin);
        E.Cmd(new { type = "join", id, quiet });
    }
    public void CreateRoom(string name, bool broadcast)
    {
        pendingMute = (DateTime.Now, S.MuteOnCreate);
        E.Cmd(new { type = "create", name, kind = broadcast ? "bc" : "chat" });
    }
    public void SendChat(string t) => E.Cmd(new { type = "chat", text = t });

    public void SwitchMic(string name)
    {
        if (name == S.MicLabel) return;
        S.MicLabel = name; S.Save();
        E.Cmd(new { type = "setMicLabel", label = name });
        if (!E.Joined) return;
        if (Ui.Ask(Room, "マイクを切り替えるには、入り直します",
            $"「{(name.Length == 0 ? "既定のマイク" : name)}」に切り替えます。同じ部屋に入り直しますか？（数秒、声が途切れます）", "入り直す", "次に入るときから"))
            E.Cmd(new { type = "reconnect" });
    }

    /// <summary>入力デバイスの一覧（マイクの許可がなくても名前は取れる）</summary>
    public async Task RefreshMics()
    {
        try
        {
            var ds = await DeviceInformation.FindAllAsync(DeviceClass.AudioCapture);
            Mics = ds.Select(d => d.Name).Distinct().ToList();
            MicsChanged?.Invoke();
        }
        catch { }
    }

    public void ConfirmOpen(string url, Window owner)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https")) return;
        var shown = Readable(u.AbsoluteUri);
        if (shown.Length > 300) shown = shown[..300];
        if (Ui.Ask(owner, "このリンクを開きますか？", shown, "ブラウザで開く")) Engine.OpenExternal(u.AbsoluteUri);
    }

    /// <summary>確認画面に出す用：%E9%9D%9E のようなパーセント表記を、読める文字に戻す（開くときは元のURLを使う）。</summary>
    static string Readable(string url)
    {
        try
        {
            var s = Uri.UnescapeDataString(url);
            // 制御文字や、向きを入れ替える文字が混じるときは、紛らわしいので元のまま見せる
            return s.Any(c => char.IsControl(c) || (c >= '‪' && c <= '‮') || (c >= '⁦' && c <= '⁩') || c == '�') ? url : s;
        }
        catch { return url; }
    }

    // ---- ウィンドウ ----
    void OpenRoom()
    {
        if (Room != null) { Room.Activate(); return; }
        Room = new RoomWindow(this);
        Room.Show();
        Room.Refresh();
    }
    public void OpenChat()
    {
        Unread = 0; ChatOpen = true;
        if (Chat == null) { Chat = new ChatWindow(this); Chat.Show(); } else Chat.Activate();
        ChatChanged?.Invoke();
    }
    public void ToggleChat() { if (Chat != null) Chat.Close(); else OpenChat(); }
    public void OpenSettings()
    {
        if (Sett != null) { Sett.Activate(); return; }
        Sett = new SettingsWindow(this); Sett.Show(); Sett.Refresh();
    }
    public void OpenProfile()
    {
        if (Prof != null) { Prof.Activate(); return; }
        Prof = new ProfileWindow(this); Prof.Show();
    }
    public void OpenHelp()
    {
        MessageBox.Show(Main,
            "ぽっと通話（potalk.app）の、非公式の Windows クライアントです。\n\n通話の仕組み（Nostr での相手探しと WebRTC）は、サイトのページをそのまま画面の外で動かし、" +
            "画面まわりだけをこちらで作り直しています。\n\n部屋の一覧から選ぶか、部屋のURLを貼って入ってください。",
            "ぽっと通話：これはなに？", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    void CloseRoomGroup()
    {
        ForceClose = true;
        try { Chat?.Close(); Sett?.Close(); Mail?.Close(); Letter?.Close(); Room?.Close(); } finally { ForceClose = false; }
        Chat = null; Sett = null; Room = null; Mail = null; Letter = null; MailOpen = false; lastLetter = ""; letterDismissed = "";
        ChatLines.Clear(); Past.Clear(); Unread = 0; ChatOpen = false; lastHands = 0;
        ChatChanged?.Invoke();
    }

    public void RequestLeave(Window owner)
    {
        if (Ui.Ask(owner, "この部屋を退出しますか？", "小窓を閉じると、部屋から退出します。", "退出して閉じる", yesBg: Ui.Red)) E.Cmd(new { type = "leave" });
    }
}
