import { useState, useEffect, useRef } from "react";
import { Search, Loader, Download, X, Upload, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/context/LanguageContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ASSET_TYPES = [
  {
    key: "grid",
    plural: "grids",
    base: "grid",
    label: "Cover",
    aspect: "aspect-[2/3]",
    contain: false,
  },
  {
    key: "hero",
    plural: "heroes",
    base: "hero",
    label: "Banner",
    aspect: "aspect-video",
    contain: false,
  },
  {
    key: "logo",
    plural: "logos",
    base: "logo",
    label: "Logo",
    aspect: "aspect-video",
    contain: true,
  },
  {
    key: "header",
    plural: "headers",
    base: "header",
    label: "Wide banner",
    aspect: "aspect-[2/1]",
    contain: false,
  },
];

const readFileAsDataUrl = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const convertImageDataUrl = (dataUrl, mimeType) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (mimeType === "image/jpeg") {
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL(mimeType, 0.92));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });

// The game page expects JPEG for covers/banners and PNG for logos.
const normalizeAssetDataUrl = (dataUrl, assetType) => {
  const targetMime = assetType === "logo" ? "image/png" : "image/jpeg";
  if (dataUrl.startsWith(`data:${targetMime};`)) return Promise.resolve(dataUrl);
  return convertImageDataUrl(dataUrl, targetMime);
};

/**
 * GameAssetSearchDialog - Search SteamGridDB and choose the artwork for a game.
 * Each asset type can be picked from the available results or uploaded locally.
 */
export const GameAssetSearchDialog = ({
  open,
  onOpenChange,
  gameName,
  isControllerMode = false,
  autoApply = false,
}) => {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedButton, setSelectedButton] = useState(0);
  const [focusedSection, setFocusedSection] = useState("results");
  const [artwork, setArtwork] = useState(null);
  const [selectedAssets, setSelectedAssets] = useState({});
  const [activeAssetType, setActiveAssetType] = useState("grid");
  const [uploadType, setUploadType] = useState(null);
  const [loadingArtwork, setLoadingArtwork] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const searchDebounceRef = useRef(null);
  const inputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const lastNavTime = useRef(0);
  const lastActionTime = useRef(0);
  const resultRefs = useRef([]);
  const autoAppliedGameId = useRef(null);

  // Auto-populate search with game name when dialog opens
  useEffect(() => {
    if (open && gameName) {
      autoAppliedGameId.current = null;
      setSearchQuery(gameName);
      handleSearch(gameName);
    }
  }, [open, gameName]);

  // Controller navigation using BigPicture's gamepad polling system
  useEffect(() => {
    if (!isControllerMode || !open) return;

    let animationFrameId;

    const getGamepadInput = () => {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];
      if (!gp) return null;

      return {
        up: gp.axes[1] < -0.5 || gp.buttons[12]?.pressed,
        down: gp.axes[1] > 0.5 || gp.buttons[13]?.pressed,
        left: gp.axes[0] < -0.5 || gp.buttons[14]?.pressed,
        right: gp.axes[0] > 0.5 || gp.buttons[15]?.pressed,
        a: gp.buttons[0]?.pressed,
        b: gp.buttons[1]?.pressed,
      };
    };

    const loop = () => {
      const gp = getGamepadInput();
      if (gp) {
        const now = Date.now();

        // Navigation
        if (now - lastNavTime.current > 170) {
          let handledNav = false;

          if (gp.up) {
            if (focusedSection === "results" && selectedIndex > 0) {
              setSelectedIndex(selectedIndex - 1);
              handledNav = true;
            } else if (focusedSection === "buttons" && selectedButton > 0) {
              setSelectedButton(selectedButton - 1);
              handledNav = true;
            } else if (
              focusedSection === "buttons" &&
              selectedButton === 0 &&
              searchResults.length > 0
            ) {
              setFocusedSection("results");
              handledNav = true;
            }
          } else if (gp.down) {
            if (
              focusedSection === "results" &&
              selectedIndex < searchResults.length - 1
            ) {
              setSelectedIndex(selectedIndex + 1);
              handledNav = true;
            } else if (focusedSection === "results" && selectedGame) {
              setFocusedSection("buttons");
              setSelectedButton(0);
              handledNav = true;
            } else if (focusedSection === "buttons" && selectedButton < 1) {
              setSelectedButton(selectedButton + 1);
              handledNav = true;
            }
          } else if (gp.left && focusedSection === "buttons") {
            if (selectedButton > 0) {
              setSelectedButton(selectedButton - 1);
              handledNav = true;
            }
          } else if (gp.right && focusedSection === "buttons") {
            if (selectedButton < 1) {
              setSelectedButton(selectedButton + 1);
              handledNav = true;
            }
          }

          if (handledNav) lastNavTime.current = now;
        }

        // Actions
        if (now - lastActionTime.current > 250) {
          let handledAction = false;

          if (gp.a) {
            if (focusedSection === "results" && searchResults[selectedIndex]) {
              handleSelectGame(searchResults[selectedIndex]);
              handledAction = true;
            } else if (focusedSection === "buttons") {
              if (selectedButton === 0 && selectedGame && !isDownloading) {
                handleDownloadAssets();
                handledAction = true;
              } else if (selectedButton === 1) {
                onOpenChange(false);
                handledAction = true;
              }
            }
          } else if (gp.b) {
            if (selectedGame && focusedSection === "buttons") {
              setSelectedGame(null);
              setArtwork(null);
              setSelectedAssets({});
              setFocusedSection("results");
              handledAction = true;
            } else {
              onOpenChange(false);
              handledAction = true;
            }
          }

          if (handledAction) lastActionTime.current = now;
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    isControllerMode,
    open,
    selectedIndex,
    searchResults,
    selectedGame,
    focusedSection,
    selectedButton,
    isDownloading,
    selectedAssets,
  ]);

  // Scroll selected item into view when navigating with controller
  useEffect(() => {
    if (
      isControllerMode &&
      focusedSection === "results" &&
      resultRefs.current[selectedIndex]
    ) {
      resultRefs.current[selectedIndex].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex, focusedSection, isControllerMode]);

  // Focus input when dialog opens (keyboard mode)
  useEffect(() => {
    if (open && !isControllerMode && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, isControllerMode]);

  const handleSearch = async query => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await window.electron.searchSteamGridGames(query);
        if (!results) throw new Error("Search failed");
        setSearchResults(results);
        setSelectedIndex(0);
      } catch (error) {
        console.error("Asset search error:", error);
        toast.error(t("library.assetSearch.searchFailed") || "Search failed");
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleSelectGame = async game => {
    setSelectedGame(game);
    setArtwork(null);
    setSelectedAssets({});
    setActiveAssetType("grid");
    setLoadingArtwork(true);

    try {
      const result = await window.electron.getSteamGridGameArtwork(game.id);
      if (!result) throw new Error("Artwork lookup failed");
      setArtwork(result);

      // Start with the top result for every type so "Apply" always does
      // something useful, even for controller users who cannot click thumbs.
      const initial = {};
      for (const type of ASSET_TYPES) {
        const list = result[type.plural] || [];
        if (list.length) initial[type.key] = list[0];
      }
      setSelectedAssets(initial);

      if (autoApply && autoAppliedGameId.current !== game.id) {
        autoAppliedGameId.current = game.id;
        await applyAssets(initial, { close: false, game });
      }
    } catch (error) {
      console.error("Failed to fetch artwork:", error);
      toast.error(t("library.assetSearch.searchFailed") || "Artwork lookup failed");
      setArtwork({ grids: [], heroes: [], logos: [], headers: [] });
    } finally {
      setLoadingArtwork(false);
    }
  };

  const pickAsset = (type, asset) => {
    setSelectedAssets(previous => ({ ...previous, [type]: asset }));
  };

  const openUpload = type => {
    setUploadType(type);
    setTimeout(() => uploadInputRef.current?.click(), 0);
  };

  const handleUpload = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !uploadType) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    try {
      const dataUrl = await normalizeAssetDataUrl(
        await readFileAsDataUrl(file),
        uploadType
      );
      setSelectedAssets(previous => ({
        ...previous,
        [uploadType]: { id: `upload-${Date.now()}`, url: dataUrl, thumb: dataUrl },
      }));
      setActiveAssetType(uploadType);
    } catch (error) {
      console.error("Failed to read image:", error);
      toast.error("Could not read that image");
    }
  };

  const applyAssets = async (
    assetsToSave = selectedAssets,
    { close = true, game = selectedGame } = {}
  ) => {
    if (!game) return;

    const chosen = ASSET_TYPES.filter(type => assetsToSave[type.key]);
    if (!chosen.length) {
      toast.error(t("library.assetSearch.selectOne") || "Choose at least one image");
      return;
    }

    setIsDownloading(true);
    try {
      let downloadedCount = 0;

      for (const type of chosen) {
        const asset = assetsToSave[type.key];
        try {
          const rawDataUrl = String(asset.url).startsWith("data:")
            ? asset.url
            : await window.electron.fetchImageAsDataUrl(asset.url);
          const dataUrl = await normalizeAssetDataUrl(rawDataUrl, type.key);
          const extension = type.key === "logo" ? "png" : "jpg";
          const filename = `${type.base}.ascendara.${extension}`;
          const result = await window.electron.saveGameAsset(
            gameName,
            filename,
            dataUrl
          );

          if (!result?.success) {
            throw new Error(result?.error || "Save failed");
          }

          downloadedCount++;

          if (type.key === "grid") {
            window.dispatchEvent(
              new CustomEvent("game-cover-updated", {
                detail: { gameName, dataUrl },
              })
            );
          }
        } catch (error) {
          console.warn(`Failed to save ${type.key}:`, error);
        }
      }

      if (downloadedCount > 0) {
        toast.success(
          t("library.assetSearch.assetsDownloaded", { count: downloadedCount }) ||
            `Saved ${downloadedCount} asset(s)`
        );

        window.dispatchEvent(
          new CustomEvent("game-assets-updated", {
            detail: { gameName },
          })
        );

        if (close) onOpenChange(false);
      } else {
        toast.error(t("library.assetSearch.noAssetsFound") || "No assets found");
      }
    } catch (error) {
      console.error("Failed to download assets:", error);
      toast.error(t("library.assetSearch.downloadFailed") || "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadAssets = () => applyAssets(selectedAssets, { close: true });

  const activeType = ASSET_TYPES.find(type => type.key === activeAssetType) || ASSET_TYPES[0];
  const activeAssets = artwork?.[activeType.plural] || [];
  const selectedForActive = selectedAssets[activeType.key];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto",
          isControllerMode ? "max-w-4xl" : "max-w-3xl"
        )}
      >
        <AlertDialogHeader>
          <AlertDialogTitle
            className={cn(
              "flex items-center gap-2",
              isControllerMode ? "text-2xl font-bold" : ""
            )}
          >
            {t("library.customizeArtwork")}
          </AlertDialogTitle>
          <AlertDialogDescription className={isControllerMode ? "text-base" : ""}>
            {t("library.customizeArtworkDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
        />

        <div className="space-y-4">
          {!isControllerMode && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  handleSearch(e.target.value);
                }}
                placeholder={
                  t("library.assetSearch.searchPlaceholder") || "Search for game..."
                }
                className="pl-10 text-primary"
              />
            </div>
          )}

          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <Loader
                className={cn(
                  isControllerMode ? "h-10 w-10" : "h-8 w-8",
                  "animate-spin text-primary"
                )}
              />
            </div>
          ) : searchResults.length > 0 ? (
            <div
              className={cn(
                "max-h-[240px] space-y-2 overflow-y-auto border p-2",
                isControllerMode ? "rounded-xl" : "rounded-lg"
              )}
            >
              {searchResults.map((result, index) => (
                <div
                  key={result.id}
                  ref={el => (resultRefs.current[index] = el)}
                  onClick={() => handleSelectGame(result)}
                  className={cn(
                    "cursor-pointer border-2 p-3 text-primary transition-all",
                    isControllerMode ? "rounded-xl" : "rounded-lg",
                    selectedGame?.id === result.id
                      ? "border-primary bg-primary/10"
                      : isControllerMode &&
                          focusedSection === "results" &&
                          index === selectedIndex
                        ? "scale-105 border-primary bg-primary/20 shadow-lg shadow-primary/30 ring-4 ring-primary/50"
                        : "border-transparent hover:border-primary/30 hover:bg-muted/50"
                  )}
                >
                  <p
                    className={isControllerMode ? "text-lg font-semibold" : "font-medium"}
                  >
                    {result.name}
                  </p>
                  {result.year && (
                    <p
                      className={
                        isControllerMode
                          ? "text-sm text-muted-foreground"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {result.year}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : searchQuery.length >= 2 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("library.assetSearch.noResults") || "No results found"}
            </div>
          ) : null}

          {selectedGame && loadingArtwork && (
            <div className="flex justify-center py-10">
              <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {selectedGame && !loadingArtwork && artwork && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {ASSET_TYPES.map(type => {
                  const selected = selectedAssets[type.key];
                  const isActive = activeAssetType === type.key;
                  return (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => setActiveAssetType(type.key)}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 text-muted-foreground hover:bg-accent/50"
                      )}
                    >
                      {type.label}
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto gap-2"
                  onClick={() => openUpload(activeType.key)}
                >
                  <Upload className="h-4 w-4" />
                  {t("library.assetSearch.upload") || "Upload"}
                </Button>
              </div>

              {activeAssets.length === 0 && !selectedForActive ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("library.assetSearch.noAssetsFound") ||
                    "No images for this type. Upload one instead."}
                </div>
              ) : (
                <div className="grid max-h-[360px] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4">
                  {selectedForActive?.url?.startsWith("data:") && (
                    <button
                      type="button"
                      className={cn(
                        "relative overflow-hidden rounded-lg border-2 border-primary ring-2 ring-primary/30",
                        activeType.aspect
                      )}
                      onClick={() => pickAsset(activeType.key, selectedForActive)}
                    >
                      <img
                        src={selectedForActive.thumb}
                        alt=""
                        className={cn(
                          "h-full w-full",
                          activeType.contain ? "object-contain p-2" : "object-cover"
                        )}
                      />
                      <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-secondary">
                        <Check className="h-4 w-4" />
                      </span>
                    </button>
                  )}
                  {activeAssets.map(asset => {
                    const isSelected = selectedForActive?.id === asset.id;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => pickAsset(activeType.key, asset)}
                        className={cn(
                          "relative overflow-hidden rounded-lg border-2 transition-all",
                          activeType.aspect,
                          isSelected
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-transparent opacity-80 hover:opacity-100"
                        )}
                      >
                        <img
                          src={asset.thumb}
                          alt=""
                          loading="lazy"
                          className={cn(
                            "h-full w-full",
                            activeType.contain ? "object-contain p-2" : "object-cover"
                          )}
                        />
                        {isSelected && (
                          <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-secondary">
                            <Check className="h-4 w-4" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {t("library.assetSearch.selectedHint") ||
                  "Pick one image per row, then apply. Unselected types keep their current artwork."}
              </p>
            </div>
          )}
        </div>

        {isControllerMode ? (
          <div className="flex gap-4 py-4">
            <button
              onClick={handleDownloadAssets}
              disabled={!selectedGame || isDownloading}
              className={cn(
                "flex flex-1 items-center justify-center gap-3 rounded-xl p-4 text-lg font-semibold transition-all duration-200",
                focusedSection === "buttons" && selectedButton === 0
                  ? "scale-105 bg-primary text-secondary shadow-lg shadow-primary/30 ring-4 ring-primary/50"
                  : "bg-muted hover:bg-muted/80",
                (!selectedGame || isDownloading) && "cursor-not-allowed opacity-50"
              )}
            >
              {isDownloading ? (
                <>
                  <Loader className="h-6 w-6 animate-spin" />
                  <span>{t("library.assetSearch.downloading") || "Saving..."}</span>
                </>
              ) : (
                <>
                  <Download className="h-6 w-6" />
                  <span>{t("library.assetSearch.apply") || "Apply artwork"}</span>
                </>
              )}
            </button>
            <button
              onClick={() => onOpenChange(false)}
              disabled={isDownloading}
              className={cn(
                "flex flex-1 items-center justify-center gap-3 rounded-xl p-4 text-lg font-semibold transition-all duration-200",
                focusedSection === "buttons" && selectedButton === 1
                  ? "scale-105 bg-muted text-foreground shadow-lg ring-4 ring-slate-500/50"
                  : "bg-muted hover:bg-muted/80",
                isDownloading && "cursor-not-allowed opacity-50"
              )}
            >
              <X className="h-6 w-6" />
              <span>{t("common.cancel") || "Cancel"}</span>
            </button>
          </div>
        ) : (
          <AlertDialogFooter>
            <Button
              onClick={handleDownloadAssets}
              disabled={!selectedGame || isDownloading}
              className="gap-2 text-secondary"
            >
              {isDownloading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  {t("library.assetSearch.downloading") || "Saving..."}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  {t("library.assetSearch.apply") || "Apply artwork"}
                </>
              )}
            </Button>
            <AlertDialogCancel disabled={isDownloading}>
              {t("common.cancel") || "Cancel"}
            </AlertDialogCancel>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
};
