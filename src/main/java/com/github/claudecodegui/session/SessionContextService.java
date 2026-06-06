package com.github.claudecodegui.session;

import com.github.claudecodegui.service.RunConfigMonitorService;
import com.github.claudecodegui.terminal.TerminalMonitorService;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.progress.ProcessCanceledException;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Computable;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Builds message payloads and provider-specific context blocks for a session.
 */
public class SessionContextService {

    private static final Logger LOG = Logger.getInstance(SessionContextService.class);

    private final Project project;
    private final int maxFileSizeBytes;

    public SessionContextService(Project project, int maxFileSizeBytes) {
        this.project = project;
        this.maxFileSizeBytes = maxFileSizeBytes;
    }

    public ClaudeSession.Message buildUserMessage(String normalizedInput, List<ClaudeSession.Attachment> attachments) {
        ClaudeSession.Message userMessage = new ClaudeSession.Message(ClaudeSession.Message.Type.USER, normalizedInput);

        try {
            JsonArray contentArr = new JsonArray();
            String userDisplayText = normalizedInput;

            if (attachments != null && !attachments.isEmpty()) {
                for (ClaudeSession.Attachment att : attachments) {
                    if (isImageAttachment(att)) {
                        contentArr.add(createImageBlock(att));
                    }
                }

                if (userDisplayText.isEmpty()) {
                    userDisplayText = generateAttachmentSummary(attachments);
                }
            }

            userDisplayText = processReferences(normalizedInput, "terminal", "Terminal Output", this::resolveTerminalContent);
            userDisplayText = processReferences(userDisplayText, "service", "Service Output", this::resolveServiceContent);

            contentArr.add(createTextBlock(userDisplayText));

            JsonObject messageObj = new JsonObject();
            messageObj.add("content", contentArr);
            JsonObject rawUser = new JsonObject();
            rawUser.add("message", messageObj);
            userMessage.raw = rawUser;
            userMessage.content = userDisplayText;

            LOG.info("[ClaudeSession] Created user message: content="
                    + (userDisplayText.length() > 50 ? userDisplayText.substring(0, 50) + "..." : userDisplayText)
                    + ", hasRaw=true, contentBlocks=" + contentArr.size());
        } catch (ProcessCanceledException e) {
            throw e;
        } catch (Exception e) {
            LOG.warn("Failed to build user message raw: " + e.getMessage());
        }

        return userMessage;
    }

    public String buildCodexContextAppend(JsonObject openedFilesJson, List<String> fileTagPaths) {
        return "";
    }

    private String processReferences(
            String input,
            String protocol,
            String blockTitle,
            Function<String, String> contentResolver
    ) {
        Pattern pattern = Pattern.compile("@" + protocol + "://([a-zA-Z0-9_]+)");
        Matcher matcher = pattern.matcher(input);
        StringBuffer result = new StringBuffer();
        int matchCount = 0;

        while (matcher.find()) {
            matchCount++;
            String safeName = matcher.group(1);
            LOG.debug("[" + protocol + "] Found mention in message: @" + protocol + "://" + safeName);
            String content = contentResolver.apply(safeName);

            if (content != null && !content.isEmpty()) {
                String block = "\n\n" + blockTitle + " (" + safeName + "):\n```\n" + content + "\n```";
                matcher.appendReplacement(result, Matcher.quoteReplacement(block));
                LOG.debug("[" + protocol + "] Successfully replaced reference for: " + safeName);
            } else {
                matcher.appendReplacement(result, "");
                LOG.debug("[" + protocol + "] Content was empty or null for: " + safeName);
            }
        }
        matcher.appendTail(result);

        if (matchCount == 0 && input.contains("@" + protocol + "://")) {
            LOG.warn("[" + protocol + "] Message contains '@" + protocol + "://' but regex did not match.");
        }

        return result.toString();
    }

    private String resolveTerminalContent(String safeName) {
        if (project == null) {
            return "";
        }

        return ApplicationManager.getApplication().runReadAction((Computable<String>) () -> {
            try {
                List<Object> widgets = TerminalMonitorService.getWidgets(project);
                LOG.debug("[Terminal] Resolving: " + safeName + ". Available widgets: " + widgets.size());

                Map<String, Integer> nameCounts = new HashMap<>();
                for (Object widget : widgets) {
                    String baseTitle = TerminalMonitorService.getWidgetTitle(widget);
                    int count = nameCounts.getOrDefault(baseTitle, 0) + 1;
                    nameCounts.put(baseTitle, count);

                    String titleText = baseTitle;
                    if (count > 1) {
                        titleText = baseTitle + " (" + count + ")";
                    }

                    String widgetSafeName = titleText.replace(" ", "_").replaceAll("[^a-zA-Z0-9_]", "");
                    LOG.debug("[Terminal] - Candidate: " + titleText + " (Safe: " + widgetSafeName + ")");

                    if (widgetSafeName.equals(safeName)) {
                        String content = TerminalMonitorService.getWidgetContent(widget);
                        LOG.debug("[Terminal] Match found! Content length: "
                                + (content != null ? content.length() : "null"));
                        return content;
                    }
                }
                LOG.debug("[Terminal] No matching terminal found for: " + safeName);
            } catch (ProcessCanceledException e) {
                throw e;
            } catch (Exception e) {
                LOG.error("[Terminal] Error resolving terminal content: " + e.getMessage(), e);
            }
            return "";
        });
    }

    private String resolveServiceContent(String safeName) {
        if (project == null) {
            return "";
        }

        return ApplicationManager.getApplication().runReadAction((Computable<String>) () -> {
            try {
                List<RunConfigMonitorService.RunConfigInfo> configs =
                        RunConfigMonitorService.getRunConfigurations(project);
                LOG.debug("[Service] Resolving: " + safeName + ". Available configs: " + configs.size());

                for (RunConfigMonitorService.RunConfigInfo config : configs) {
                    String displayName = config.getDisplayName();
                    String widgetSafeName = displayName.replace(" ", "_").replaceAll("[^a-zA-Z0-9_]", "");
                    LOG.debug("[Service] - Candidate: " + displayName + " (Safe: " + widgetSafeName + ")");

                    if (widgetSafeName.equals(safeName)) {
                        String content = config.getContent();
                        LOG.debug("[Service] Match found! Content length: "
                                + (content != null ? content.length() : "null"));
                        return content;
                    }
                }
                LOG.debug("[Service] No matching service found for: " + safeName);
            } catch (ProcessCanceledException e) {
                throw e;
            } catch (Exception e) {
                LOG.error("[Service] Error resolving service content: " + e.getMessage(), e);
            }
            return "";
        });
    }

    private boolean isImageAttachment(ClaudeSession.Attachment att) {
        if (att == null) {
            return false;
        }
        String mediaType = att.mediaType != null ? att.mediaType : "";
        return mediaType.startsWith("image/") && att.data != null;
    }

    private JsonObject createImageBlock(ClaudeSession.Attachment att) {
        JsonObject imageBlock = new JsonObject();
        imageBlock.addProperty("type", "image");

        JsonObject source = new JsonObject();
        source.addProperty("type", "base64");
        source.addProperty("media_type", att.mediaType);
        source.addProperty("data", att.data);
        imageBlock.add("source", source);

        return imageBlock;
    }

    private JsonObject createTextBlock(String text) {
        JsonObject textBlock = new JsonObject();
        textBlock.addProperty("type", "text");
        textBlock.addProperty("text", text);
        return textBlock;
    }

    private String generateAttachmentSummary(List<ClaudeSession.Attachment> attachments) {
        int imageCount = 0;
        List<String> names = new ArrayList<>();

        for (ClaudeSession.Attachment att : attachments) {
            if (att != null && att.fileName != null && !att.fileName.isEmpty()) {
                names.add(att.fileName);
            }
            String mediaType = att != null && att.mediaType != null ? att.mediaType : "";
            if (mediaType.startsWith("image/")) {
                imageCount++;
            }
        }

        if (names.isEmpty()) {
            if (imageCount > 0) {
                return "[Uploaded " + imageCount + " image(s)]";
            }
            return "[Uploaded attachment(s)]";
        }

        if (names.size() > 3) {
            return "[Uploaded Attachments: " + String.join(", ", names.subList(0, 3)) + ", ...]";
        }
        return "[Uploaded Attachments: " + String.join(", ", names) + "]";
    }

    private String readFileContent(String filePath) {
        try {
            File file = new File(filePath);
            if (!file.exists() || !file.isFile() || !file.canRead()) {
                LOG.warn("[Codex Context] File not accessible: " + filePath);
                return null;
            }

            long fileSize = file.length();
            if (fileSize > maxFileSizeBytes) {
                LOG.info("[Codex Context] File too large, reading first "
                        + (maxFileSizeBytes / 1024)
                        + "KB: " + filePath + " (" + fileSize + " bytes)");
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] buffer = new byte[maxFileSizeBytes];
                    int bytesRead = fis.read(buffer);
                    if (bytesRead > 0) {
                        return new String(buffer, 0, bytesRead, StandardCharsets.UTF_8)
                                + "\n\n... (file truncated, showing first "
                                + (maxFileSizeBytes / 1024)
                                + "KB of " + (fileSize / 1024) + "KB)";
                    }
                }
                return null;
            }

            String content = Files.readString(file.toPath(), StandardCharsets.UTF_8);
            LOG.info("[Codex Context] Read file content: " + filePath + " (" + fileSize + " bytes)");
            return content;
        } catch (Exception e) {
            LOG.warn("[Codex Context] Failed to read file: " + filePath + ", error: " + e.getMessage());
            return null;
        }
    }

    private String getFileExtension(String filePath) {
        if (filePath == null) {
            return "";
        }
        int lastDot = filePath.lastIndexOf('.');
        if (lastDot > 0 && lastDot < filePath.length() - 1) {
            return filePath.substring(lastDot + 1).toLowerCase();
        }
        return "";
    }
}
