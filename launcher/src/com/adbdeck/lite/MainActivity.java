package com.adbdeck.lite;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A quiet home screen in two parts.
 * Home: a large clock and date in the middle, network status in the corner and a dock of favourites at the bottom.
 * All apps (Down from the dock, or the last dock tile): TV inputs and apps as large rounded tiles; Back returns.
 * The tile in focus grows, gets a ring and shows its name. Apps can be hidden and sorted by use.
 * No recommendations, no network traffic, no background work.
 *
 * Nested classes are static on purpose: JDK 21 compiles inner ones in a way older d8 versions crash on.
 */
public class MainActivity extends Activity {
    private static final int INK = 0xFFF5F5F7;
    private static final int MUTED = 0xFFA1A1A6;
    private static final int TILE = 0xFF2C2C2E;
    private static final int GOOD = 0xFF34C759;
    private static final int WARN = 0xFFFFB340;
    private static final int BAD = 0xFFFF6961;
    private static final int COLUMNS = 5;
    private static final int DOCK_SLOTS = 6; // up to five favourites and the All apps tile
    private static final float GROW = 1.16f;
    private static final String SETTINGS_KEY = "settings";
    private static final String ALL_KEY = "all";

    private static final class Item {
        String key;
        CharSequence label;
        Drawable image;
        boolean wide; // a 16:9 banner instead of a square icon
        boolean input;
        boolean system;
        int tint = TILE;
        Intent intent;
        String pkg;
    }

    private static final class PackagesChanged extends BroadcastReceiver {
        private final MainActivity home;

        PackagesChanged(MainActivity home) {
            this.home = home;
        }

        @Override
        public void onReceive(Context context, Intent intent) {
            // An install sends several broadcasts in a row; read the list once they settle.
            home.ui.removeCallbacks(home.reload);
            home.ui.postDelayed(home.reload, 400);
        }
    }

    private static final class NetworkWatch extends ConnectivityManager.NetworkCallback {
        private final MainActivity home;

        NetworkWatch(MainActivity home) {
            this.home = home;
        }

        private void changed() {
            home.ui.post(home.status);
        }

        @Override
        public void onAvailable(Network network) {
            changed();
        }

        @Override
        public void onLost(Network network) {
            changed();
        }

        @Override
        public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
            changed();
        }
    }

    /** Back on Android 13+ when the new back handling is on (always on Android 16+ with this target SDK). */
    private static final class Back implements android.window.OnBackInvokedCallback {
        private final MainActivity home;

        Back(MainActivity home) {
            this.home = home;
        }

        @Override
        public void onBackInvoked() {
            home.back();
        }
    }

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable reload = this::load;
    private final Runnable status = this::updateStatus;
    private final BroadcastReceiver packagesChanged = new PackagesChanged(this);
    private final List<Item> items = new ArrayList<>();
    private NetworkWatch networkWatch;
    private SharedPreferences prefs;
    private SharedPreferences usage;
    private FrameLayout homePage;
    private LinearLayout dock;
    private ScrollView appsPage;
    private LinearLayout grid;
    private TextView network;
    private View firstDock;
    private View firstGrid;
    private View wanted;
    private String focusKey;
    private boolean appsOpen;
    private boolean loading;
    private boolean loadAgain;
    private int side;
    private int gap;
    private int cellWidth;
    private int cellHeight;
    private int dockWidth;
    private int dockHeight;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("home", MODE_PRIVATE);
        usage = getSharedPreferences("usage", MODE_PRIVATE);
        GradientDrawable backdrop = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {0xFF2A3140, 0xFF14171D, 0xFF050506});
        getWindow().setBackgroundDrawable(backdrop);

        int width = getResources().getDisplayMetrics().widthPixels;
        side = dp(64);
        gap = dp(22);
        cellWidth = (width - 2 * side - (COLUMNS - 1) * gap) / COLUMNS;
        cellHeight = cellWidth * 9 / 16;
        dockWidth = (width - 2 * side - 2 * dp(18) - (DOCK_SLOTS - 1) * gap) / DOCK_SLOTS;
        dockHeight = dockWidth * 9 / 16;

        FrameLayout root = new FrameLayout(this);
        root.setClipChildren(false);
        root.addView(homePage(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(appsPage(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_PACKAGE_ADDED);
        filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
        filter.addAction(Intent.ACTION_PACKAGE_CHANGED);
        filter.addDataScheme("package");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packagesChanged, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(packagesChanged, filter);

        if (Build.VERSION.SDK_INT >= 24) {
            try {
                networkWatch = new NetworkWatch(this);
                connectivity().registerDefaultNetworkCallback(networkWatch);
            } catch (Throwable e) {
                networkWatch = null;
            }
        }

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, new Back(this));
        }

        load();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateStatus();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        unregisterReceiver(packagesChanged);
        if (networkWatch != null) {
            try {
                connectivity().unregisterNetworkCallback(networkWatch);
            } catch (Throwable ignored) {
                // Already gone.
            }
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Pressing Home always comes back to the dock.
        showHome();
        if (firstDock != null) firstDock.requestFocus();
    }

    @Override
    public void onBackPressed() {
        back();
    }

    private void back() {
        // This is the home screen; there is nothing behind it. Back leaves All apps, or goes to the first dock tile.
        if (appsOpen) showHome();
        else if (firstDock != null) firstDock.requestFocus();
    }

    // ---------- the two pages ----------

    private View homePage() {
        homePage = new FrameLayout(this);
        homePage.setClipChildren(false);
        homePage.setClipToPadding(false);

        // Network status in the top corner; OK on it opens the network settings.
        network = pill("Checking network…", null, v -> {
            if (!start(new Intent(Settings.ACTION_WIFI_SETTINGS))) open(new Intent(Settings.ACTION_SETTINGS));
        });
        network.setCompoundDrawablePadding(dp(10));
        FrameLayout.LayoutParams corner = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END);
        corner.setMargins(0, dp(36), side, 0);
        homePage.addView(network, corner);

        // The clock, centred in the space above the dock.
        LinearLayout time = new LinearLayout(this);
        time.setOrientation(LinearLayout.VERTICAL);
        time.setGravity(Gravity.CENTER_HORIZONTAL);
        TextClock clock = new TextClock(this);
        clock.setTextColor(INK);
        clock.setTextSize(112);
        clock.setTypeface(Typeface.create("sans-serif-thin", Typeface.NORMAL));
        clock.setIncludeFontPadding(false);
        clock.setFormat12Hour("h:mm");
        time.addView(clock);
        TextClock date = new TextClock(this);
        date.setFormat12Hour("EEEE, d MMMM");
        date.setFormat24Hour("EEEE, d MMMM");
        date.setTextColor(MUTED);
        date.setTextSize(24);
        date.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        date.setPadding(0, dp(10), 0, 0);
        time.addView(date);
        FrameLayout.LayoutParams middle = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL | Gravity.TOP);
        middle.topMargin = getResources().getDisplayMetrics().heightPixels / 5;
        homePage.addView(time, middle);

        // The dock: a soft glass shelf along the bottom.
        dock = new LinearLayout(this);
        dock.setClipChildren(false);
        dock.setClipToPadding(false);
        GradientDrawable glass = new GradientDrawable();
        glass.setColor(0x1FFFFFFF);
        glass.setCornerRadius(dp(28));
        dock.setBackground(glass);
        dock.setPadding(dp(18), dp(18), dp(18), 0);
        FrameLayout.LayoutParams bottom = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        bottom.bottomMargin = dp(64);
        homePage.addView(dock, bottom);

        TextView hint = text("Press ▼ for all apps · hold OK to change a tile", 13, 0x80FFFFFF);
        FrameLayout.LayoutParams under = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        under.bottomMargin = dp(26);
        homePage.addView(hint, under);
        return homePage;
    }

    private View appsPage() {
        appsPage = new ScrollView(this);
        appsPage.setVerticalScrollBarEnabled(false);
        appsPage.setOverScrollMode(View.OVER_SCROLL_NEVER);
        appsPage.setClipChildren(false);
        appsPage.setClipToPadding(false);
        appsPage.setFillViewport(true);
        appsPage.setVisibility(View.GONE);
        appsPage.setBackgroundColor(0xF00B0D11);

        grid = new LinearLayout(this);
        grid.setOrientation(LinearLayout.VERTICAL);
        grid.setPadding(side, dp(40), side, dp(72));
        grid.setClipChildren(false);
        grid.setClipToPadding(false);
        appsPage.addView(grid, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return appsPage;
    }

    private void showApps() {
        if (appsOpen) return;
        appsOpen = true;
        appsPage.setAlpha(0f);
        appsPage.setVisibility(View.VISIBLE);
        appsPage.animate().alpha(1f).setDuration(180).start();
        homePage.setVisibility(View.INVISIBLE);
        appsPage.scrollTo(0, 0);
        if (firstGrid != null) firstGrid.requestFocus();
    }

    private void showHome() {
        if (!appsOpen) return;
        appsOpen = false;
        homePage.setVisibility(View.VISIBLE);
        appsPage.setVisibility(View.GONE);
        View back = null;
        for (int i = 0; i < dock.getChildCount(); i++) {
            if (ALL_KEY.equals(dock.getChildAt(i).getTag())) back = dock.getChildAt(i);
        }
        if (back != null) back.requestFocus();
    }

    // ---------- network ----------

    private ConnectivityManager connectivity() {
        return (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    private void updateStatus() {
        if (network == null) return;
        String text = "Offline";
        int color = BAD;
        try {
            ConnectivityManager cm = connectivity();
            if (Build.VERSION.SDK_INT >= 23) {
                Network active = cm.getActiveNetwork();
                NetworkCapabilities caps = active == null ? null : cm.getNetworkCapabilities(active);
                if (caps != null) {
                    text = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? "Ethernet"
                            : caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "Wi-Fi" : "Connected";
                    if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                        color = GOOD;
                    } else {
                        text += " · no internet";
                        color = WARN;
                    }
                }
            } else {
                NetworkInfo info = cm.getActiveNetworkInfo();
                if (info != null && info.isConnected()) {
                    text = info.getType() == ConnectivityManager.TYPE_ETHERNET ? "Ethernet"
                            : info.getType() == ConnectivityManager.TYPE_WIFI ? "Wi-Fi" : "Connected";
                    color = GOOD;
                }
            }
        } catch (Throwable ignored) {
            // Leave it as offline.
        }
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(color);
        dot.setBounds(0, 0, dp(9), dp(9));
        network.setCompoundDrawables(dot, null, null, null);
        network.setText(text);
    }

    // ---------- opening things ----------

    private boolean start(Intent intent) {
        try {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void open(Intent intent) {
        if (intent == null) return;
        if (!start(intent)) Toast.makeText(this, "This cannot be opened.", Toast.LENGTH_SHORT).show();
    }

    private void launch(Item item) {
        if (ALL_KEY.equals(item.key)) {
            showApps();
            return;
        }
        open(item.intent);
        usage.edit().putInt(item.key, usage.getInt(item.key, 0) + 1).apply();
        if (sortByUse()) {
            // Re-sort quietly once the app is in front, so the grid is not seen jumping.
            ui.postDelayed(this::show, 800);
        }
    }

    // ---------- reading inputs and apps ----------

    /** Reads the list of apps and inputs away from the screen thread. */
    private void load() {
        if (loading) {
            loadAgain = true;
            return;
        }
        loading = true;
        new Thread(() -> {
            final List<Item> found = new ArrayList<>(apps());
            found.add(settings());
            try {
                found.addAll(inputs());
            } catch (Throwable ignored) {
                // Not every device has TV inputs.
            }
            ui.post(() -> {
                loading = false;
                if (isFinishing()) return;
                items.clear();
                items.addAll(found);
                show();
                if (loadAgain) {
                    loadAgain = false;
                    load();
                }
            });
        }).start();
    }

    private List<Item> inputs() {
        List<Item> out = new ArrayList<>();
        TvInputManager manager = (TvInputManager) getSystemService(Context.TV_INPUT_SERVICE);
        if (manager == null) return out;
        for (TvInputInfo info : manager.getTvInputList()) {
            if (!info.isPassthroughInput()) continue;
            if (Build.VERSION.SDK_INT >= 24 && info.isHidden(this)) continue;
            Item item = new Item();
            item.key = "input:" + info.getId();
            item.input = true;
            CharSequence custom = Build.VERSION.SDK_INT >= 24 ? info.loadCustomLabel(this) : null;
            item.label = TextUtils.isEmpty(custom) ? info.loadLabel(this) : custom;
            item.image = info.loadIcon(this);
            item.tint = 0xFF1F2937;
            item.intent = new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(info.getId()));
            out.add(item);
        }
        Collections.sort(out, (a, b) -> String.valueOf(a.label).compareToIgnoreCase(String.valueOf(b.label)));
        return out;
    }

    private Item settings() {
        Item item = new Item();
        item.key = SETTINGS_KEY;
        item.label = "Settings";
        item.system = true;
        item.intent = new Intent(Settings.ACTION_SETTINGS);
        ResolveInfo target = getPackageManager().resolveActivity(item.intent, 0);
        if (target != null) item.image = target.loadIcon(getPackageManager());
        item.tint = 0xFF3A3A3C;
        return item;
    }

    private Item allApps() {
        Item item = new Item();
        item.key = ALL_KEY;
        item.label = "All apps";
        item.tint = 0xFF3A3A3C;
        return item;
    }

    private List<Item> apps() {
        PackageManager pm = getPackageManager();
        List<Item> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        seen.add(getPackageName());
        // TV apps first, then phone-style apps that have no TV entry.
        for (String category : new String[] {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent query = new Intent(Intent.ACTION_MAIN).addCategory(category);
            for (ResolveInfo info : pm.queryIntentActivities(query, 0)) {
                String pkg = info.activityInfo.packageName;
                if (!seen.add(pkg)) continue;
                Item item = new Item();
                item.key = pkg;
                item.pkg = pkg;
                item.label = info.loadLabel(pm);
                ApplicationInfo app = info.activityInfo.applicationInfo;
                item.system = app != null && (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
                Drawable banner = info.activityInfo.loadBanner(pm);
                item.wide = banner != null;
                item.image = banner != null ? banner : info.loadIcon(pm);
                if (!item.wide) item.tint = tintOf(item.image);
                item.intent = new Intent(Intent.ACTION_MAIN).addCategory(category).setClassName(pkg, info.activityInfo.name);
                out.add(item);
            }
        }
        Collections.sort(out, (a, b) -> String.valueOf(a.label).compareToIgnoreCase(String.valueOf(b.label)));
        return out;
    }

    /** A dark shade of an icon's average colour, so a square icon sits on a tile that suits it. */
    private static int tintOf(Drawable icon) {
        if (icon == null) return TILE;
        try {
            Bitmap small = Bitmap.createBitmap(12, 12, Bitmap.Config.ARGB_8888);
            icon.setBounds(0, 0, 12, 12);
            icon.draw(new Canvas(small));
            long r = 0;
            long g = 0;
            long b = 0;
            int n = 0;
            for (int y = 0; y < 12; y++) {
                for (int x = 0; x < 12; x++) {
                    int c = small.getPixel(x, y);
                    if (Color.alpha(c) < 128) continue;
                    r += Color.red(c);
                    g += Color.green(c);
                    b += Color.blue(c);
                    n++;
                }
            }
            small.recycle();
            if (n == 0) return TILE;
            return Color.rgb((int) (r / n * 0.45f) + 18, (int) (g / n * 0.45f) + 18, (int) (b / n * 0.45f) + 18);
        } catch (Throwable e) {
            return TILE;
        }
    }

    // ---------- choices the viewer keeps ----------

    private List<String> list(String name) {
        String saved = prefs.getString(name, "");
        List<String> out = new ArrayList<>();
        if (!saved.isEmpty()) out.addAll(Arrays.asList(saved.split("\n")));
        return out;
    }

    private void save(String name, List<String> values) {
        prefs.edit().putString(name, TextUtils.join("\n", values)).apply();
    }

    /** Keys of the tiles in the dock, in order. Before anything is chosen: the first four apps and Settings. */
    private List<String> pins() {
        if (prefs.contains("pins")) return list("pins");
        List<String> pins = new ArrayList<>();
        for (Item item : items) {
            if (item.pkg != null && pins.size() < COLUMNS - 1) pins.add(item.key);
        }
        pins.add(SETTINGS_KEY);
        return pins;
    }

    private Set<String> hidden() {
        return new HashSet<>(list("hidden"));
    }

    private boolean sortByUse() {
        return "used".equals(prefs.getString("sort", "az"));
    }

    private void menu(Item item) {
        if (ALL_KEY.equals(item.key)) return;
        List<String> pins = pins();
        boolean pinned = pins.contains(item.key);
        List<String> choices = new ArrayList<>();
        choices.add(pinned ? "Remove from dock" : "Add to dock");
        if (pinned && pins.indexOf(item.key) > 0) choices.add("Move left");
        if (pinned && pins.indexOf(item.key) < pins.size() - 1) choices.add("Move right");
        if (!SETTINGS_KEY.equals(item.key)) choices.add("Hide from home screen");
        if (item.pkg != null) choices.add("App info");
        if (item.pkg != null && !item.system) choices.add("Uninstall");
        String[] labels = choices.toArray(new String[0]);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(item.label)
                .setItems(labels, (dialog, which) -> choose(item, labels[which]))
                .show();
    }

    private void choose(Item item, String choice) {
        List<String> pins = pins();
        int at = pins.indexOf(item.key);
        if (choice.equals("App info")) {
            open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + item.pkg)));
            return;
        } else if (choice.equals("Uninstall")) {
            open(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + item.pkg)));
            return;
        } else if (choice.equals("Hide from home screen")) {
            List<String> hidden = list("hidden");
            if (!hidden.contains(item.key)) hidden.add(item.key);
            save("hidden", hidden);
            pins.remove(item.key);
            focusKey = null;
        } else if (choice.equals("Remove from dock")) {
            pins.remove(item.key);
            focusKey = appsOpen ? item.key : null;
        } else if (choice.equals("Add to dock")) {
            if (pins.size() >= COLUMNS) {
                Toast.makeText(this, "The dock is full. Remove a tile from it first.", Toast.LENGTH_LONG).show();
                return;
            }
            pins.add(item.key);
            focusKey = item.key;
        } else if (choice.equals("Move left") && at > 0) {
            Collections.swap(pins, at, at - 1);
            focusKey = item.key;
        } else if (choice.equals("Move right") && at >= 0 && at < pins.size() - 1) {
            Collections.swap(pins, at, at + 1);
            focusKey = item.key;
        }
        save("pins", pins);
        show();
    }

    private void unhide() {
        Set<String> hidden = hidden();
        final List<Item> shown = new ArrayList<>();
        for (Item item : items) {
            if (hidden.contains(item.key)) shown.add(item);
        }
        if (shown.isEmpty()) return;
        String[] names = new String[shown.size()];
        final boolean[] keep = new boolean[shown.size()];
        for (int i = 0; i < names.length; i++) {
            names[i] = String.valueOf(shown.get(i).label);
            keep[i] = true;
        }
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Hidden apps · untick to show again")
                .setMultiChoiceItems(names, keep, (dialog, which, checked) -> keep[which] = checked)
                .setPositiveButton("Done", (dialog, which) -> {
                    List<String> still = new ArrayList<>();
                    for (int i = 0; i < keep.length; i++) {
                        if (keep[i]) still.add(shown.get(i).key);
                    }
                    save("hidden", still);
                    focusKey = "footer:hidden";
                    show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    // ---------- drawing ----------

    private void show() {
        dock.removeAllViews();
        grid.removeAllViews();
        firstDock = null;
        firstGrid = null;
        wanted = null;
        Set<String> hidden = hidden();

        List<Item> docked = new ArrayList<>();
        for (String key : pins()) {
            for (Item item : items) {
                if (item.key.equals(key) && !hidden.contains(key) && docked.size() < COLUMNS) docked.add(item);
            }
        }
        docked.add(allApps());
        for (Item item : docked) {
            dock.addView(tile(item, true, dock.getChildCount() == docked.size() - 1));
        }

        // All apps lists everything that is not hidden, the docked ones included.
        List<Item> inputs = new ArrayList<>();
        List<Item> apps = new ArrayList<>();
        int hiddenCount = 0;
        for (Item item : items) {
            if (hidden.contains(item.key)) hiddenCount++;
            else if (item.input) inputs.add(item);
            else apps.add(item);
        }
        if (sortByUse()) {
            // Most opened first; Settings stays last. The sort is stable, so ties keep A–Z order.
            Collections.sort(apps, (a, b) -> {
                if (SETTINGS_KEY.equals(a.key) != SETTINGS_KEY.equals(b.key)) return SETTINGS_KEY.equals(a.key) ? 1 : -1;
                return usage.getInt(b.key, 0) - usage.getInt(a.key, 0);
            });
        }

        LinearLayout head = row();
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setPadding(dp(2), 0, 0, dp(8));
        TextView title = text("All apps", 30, INK);
        title.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextClock clock = new TextClock(this);
        clock.setTextColor(MUTED);
        clock.setTextSize(18);
        head.addView(clock);
        grid.addView(head);

        if (!inputs.isEmpty()) section("Inputs", inputs);
        if (!apps.isEmpty()) section("Apps", apps);
        footer(hiddenCount);

        if (wanted == null) wanted = appsOpen ? firstGrid : firstDock;
        if (wanted != null) wanted.requestFocus();
    }

    private void section(String title, List<Item> list) {
        TextView heading = text(title, 15, MUTED);
        heading.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        heading.setPadding(dp(2), dp(18), 0, dp(14));
        grid.addView(heading);
        LinearLayout line = null;
        for (Item item : list) {
            if (line == null || line.getChildCount() == COLUMNS) {
                line = row();
                grid.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
            line.addView(tile(item, false, line.getChildCount() == COLUMNS - 1));
        }
    }

    private void footer(int hiddenCount) {
        LinearLayout bar = row();
        bar.setPadding(0, dp(28), 0, 0);
        TextView sort = pill(sortByUse() ? "Sort: most used" : "Sort: A–Z", "footer:sort", v -> {
            prefs.edit().putString("sort", sortByUse() ? "az" : "used").apply();
            focusKey = "footer:sort";
            show();
        });
        bar.addView(sort);
        if (hiddenCount > 0) {
            TextView hiddenButton = pill("Hidden apps (" + hiddenCount + ")", "footer:hidden", v -> unhide());
            LinearLayout.LayoutParams where = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            where.leftMargin = dp(12);
            bar.addView(hiddenButton, where);
        }
        grid.addView(bar);
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setClipChildren(false);
        row.setClipToPadding(false);
        return row;
    }

    /** A small rounded button that turns light when in focus. */
    private TextView pill(String value, String key, View.OnClickListener click) {
        TextView button = text(value, 14, MUTED);
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setPadding(dp(18), dp(10), dp(18), dp(10));
        if (Build.VERSION.SDK_INT >= 26) button.setDefaultFocusHighlightEnabled(false);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(22));
        shape.setColor(0x14FFFFFF);
        button.setBackground(shape);
        button.setOnFocusChangeListener((view, focused) -> {
            shape.setColor(focused ? INK : 0x14FFFFFF);
            button.setTextColor(focused ? 0xFF111114 : MUTED);
        });
        button.setOnClickListener(click);
        if (key != null && key.equals(focusKey) && appsOpen) wanted = button;
        return button;
    }

    private View tile(Item item, boolean inDock, boolean lastInRow) {
        int width = inDock ? dockWidth : cellWidth;
        int height = inDock ? dockHeight : cellHeight;
        LinearLayout cell = new LinearLayout(this);
        cell.setOrientation(LinearLayout.VERTICAL);
        cell.setFocusable(true);
        cell.setFocusableInTouchMode(true);
        cell.setClipChildren(false);
        cell.setClipToPadding(false);
        cell.setTag(item.key);
        if (Build.VERSION.SDK_INT >= 26) cell.setDefaultFocusHighlightEnabled(false);
        LinearLayout.LayoutParams where = new LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        where.rightMargin = lastInRow ? 0 : gap;
        cell.setLayoutParams(where);

        FrameLayout card = new FrameLayout(this);
        GradientDrawable shape = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {lighten(item.tint), item.tint});
        shape.setCornerRadius(dp(14));
        card.setBackground(shape);
        card.setClipToOutline(true);
        // A ring around the tile in focus, so it is easy to spot from the sofa.
        GradientDrawable ring = new GradientDrawable();
        ring.setCornerRadius(dp(14));
        ring.setStroke(dp(3), INK);
        ring.setAlpha(0);
        card.setForeground(ring);
        if (ALL_KEY.equals(item.key)) {
            card.addView(dots(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        } else if (item.image != null) {
            ImageView image = new ImageView(this);
            int size = item.wide ? ViewGroup.LayoutParams.MATCH_PARENT : height * 62 / 100;
            image.setScaleType(item.wide ? ImageView.ScaleType.CENTER_CROP : ImageView.ScaleType.FIT_CENTER);
            image.setImageDrawable(item.image);
            card.addView(image, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        } else {
            // An input or app without a picture shows its name instead.
            TextView glyph = text(String.valueOf(item.label), inDock ? 17 : 20, INK);
            glyph.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            glyph.setGravity(Gravity.CENTER);
            glyph.setSingleLine(true);
            card.addView(glyph, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        cell.addView(card, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height));

        // The name only shows under the tile in focus.
        TextView label = text(String.valueOf(item.label), 13, INK);
        label.setGravity(Gravity.CENTER_HORIZONTAL);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        label.setAlpha(0f);
        label.setPadding(0, dp(12), 0, dp(8));
        cell.addView(label, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        cell.setOnFocusChangeListener((view, focused) -> {
            card.animate().scaleX(focused ? GROW : 1f).scaleY(focused ? GROW : 1f).translationZ(focused ? dp(16) : 0).setDuration(150).start();
            label.animate().alpha(focused ? 1f : 0f).translationY(focused ? dp(4) : 0).setDuration(150).start();
            ring.setAlpha(focused ? 255 : 0);
            if (focused) focusKey = item.key;
        });
        cell.setOnClickListener(view -> launch(item));
        cell.setOnLongClickListener(view -> {
            menu(item);
            return true;
        });
        cell.setOnKeyListener((view, code, event) -> {
            if (inDock && code == KeyEvent.KEYCODE_DPAD_DOWN) {
                // Down from the dock opens All apps.
                if (event.getAction() == KeyEvent.ACTION_DOWN) showApps();
                return true;
            }
            if (code != KeyEvent.KEYCODE_MENU) return false;
            if (event.getAction() == KeyEvent.ACTION_UP) menu(item);
            return true;
        });
        if (inDock && firstDock == null) firstDock = cell;
        if (!inDock && firstGrid == null) firstGrid = cell;
        if (item.key.equals(focusKey) && inDock != appsOpen) wanted = cell;
        return cell;
    }

    /** A 3×3 grid of dots: the All apps symbol. */
    private View dots() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int size = dp(9);
        int space = dp(6);
        for (int r = 0; r < 3; r++) {
            LinearLayout line = new LinearLayout(this);
            for (int c = 0; c < 3; c++) {
                View dot = new View(this);
                GradientDrawable round = new GradientDrawable();
                round.setShape(GradientDrawable.OVAL);
                round.setColor(INK);
                dot.setBackground(round);
                LinearLayout.LayoutParams where = new LinearLayout.LayoutParams(size, size);
                where.setMargins(c == 0 ? 0 : space, r == 0 ? 0 : space, 0, 0);
                line.addView(dot, where);
            }
            box.addView(line);
        }
        return box;
    }

    private static int lighten(int color) {
        return Color.rgb(Math.min(255, Color.red(color) + 22), Math.min(255, Color.green(color) + 22), Math.min(255, Color.blue(color) + 22));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }
}
