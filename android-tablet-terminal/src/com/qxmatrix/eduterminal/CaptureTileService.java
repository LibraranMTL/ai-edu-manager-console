package com.qxmatrix.eduterminal;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

public class CaptureTileService extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        String status = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE)
            .getString(CaptureProjectionService.KEY_STATUS, "idle");
        if ("capturing".equals(status)) {
            startService(new Intent(this, CaptureProjectionService.class).setAction(CaptureProjectionService.ACTION_PAUSE));
        } else if ("paused".equals(status)) {
            startService(new Intent(this, CaptureProjectionService.class).setAction(CaptureProjectionService.ACTION_RESUME));
        } else {
            Intent activityIntent = new Intent(this, MainActivity.class)
                .putExtra("start_screen_capture", true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (Build.VERSION.SDK_INT >= 34) {
                PendingIntent pending = PendingIntent.getActivity(this, 5202, activityIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                startActivityAndCollapse(pending);
            } else {
                startActivityAndCollapse(activityIntent);
            }
        }
        updateTile();
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) return;
        String status = getSharedPreferences(CaptureProjectionService.PREFS, MODE_PRIVATE)
            .getString(CaptureProjectionService.KEY_STATUS, "idle");
        if ("capturing".equals(status)) {
            tile.setState(Tile.STATE_ACTIVE);
            tile.setLabel("采集中 · 点按暂停");
        } else if ("paused".equals(status)) {
            tile.setState(Tile.STATE_INACTIVE);
            tile.setLabel("采集已暂停");
        } else {
            tile.setState(Tile.STATE_INACTIVE);
            tile.setLabel("屏幕资料采集");
        }
        tile.updateTile();
    }

    public static void requestRefresh(Context context) {
        if (Build.VERSION.SDK_INT >= 24) {
            TileService.requestListeningState(context, new ComponentName(context, CaptureTileService.class));
        }
    }
}
