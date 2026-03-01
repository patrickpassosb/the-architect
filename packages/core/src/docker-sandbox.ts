import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

function stripAnsi(str: string): string {
  return str.replace(
    /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

export interface SandboxConfig {
  image: string;
  memoryLimit: string;
  cpuLimit: number;
  workdir: string;
}

export interface SpawnResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export interface StreamingContext {
  publisher: {
    publish: (channel: string, message: string) => Promise<number>;
  };
  channel: string;
  agentLabel: string;
}

export async function runVibeInSandbox(
  sessionId: string,
  prompt: string,
  config: SandboxConfig,
  options: {
    maxTurns: number;
    dryRun: boolean;
    timeoutMs: number;
    streaming?: StreamingContext;
  }
): Promise<SpawnResult> {
  const containerName = `architect-build-${sessionId}-${Date.now()}`;
  
  const dockerArgs = [
    "run",
    "--rm",
    "--name", containerName,
    "--memory", config.memoryLimit,
    "--cpus", config.cpuLimit.toString(),
    "-v", `${config.workdir}:/workspace`,
    "--workdir", "/workspace",
    config.image,
    "vibe",
    "--workdir", "/workspace",
    "-p", prompt,
    "--max-turns", options.maxTurns.toString(),
    "--output", "streaming"
  ];

  if (options.dryRun) {
    dockerArgs.push("--agent", "plan");
  } else {
    dockerArgs.push("--agent", "auto-approve");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const publishLine = (line: string) => {
      if (options.streaming && line.trim()) {
        let displayData = line;
        try {
          const parsed = JSON.parse(line);
          if (parsed.content) {
            displayData = parsed.content;
          } else if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            displayData = `[Tool] ${parsed.tool_calls.map((tc: unknown) => {
              const tcObj = tc as { function?: { name?: string } };
              return tcObj.function?.name || "unnamed";
            }).join(", ")}`;
          } else if (parsed.role === "user") {
            return;
          } else if (parsed.role === "assistant" && !parsed.content && !parsed.tool_calls) {
            return;
          }
        } catch {
          // raw line - strip ANSI codes for clean display
          displayData = stripAnsi(line);
        }

        // Always strip ANSI from final output
        displayData = stripAnsi(displayData);

        const message = JSON.stringify({
          type: "build_log",
          agent: options.streaming.agentLabel,
          data: displayData
        });
        options.streaming.publisher.publish(options.streaming.channel, message).catch(() => {});
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
    }, options.timeoutMs);

    const handleData = (data: Buffer, buffer: string, isStdout: boolean) => {
      const text = data.toString("utf8");
      if (isStdout) {
        stdout += text;
      } else {
        stderr += text;
      }
      buffer += text;
      const lines = buffer.split("\n");
      const remaining = lines.pop() ?? "";
      for (const line of lines) {
        publishLine(line);
      }
      return remaining;
    };

    child.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer = handleData(data, stdoutBuffer, true);
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderrBuffer = handleData(data, stderrBuffer, false);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      if (stdoutBuffer.trim()) publishLine(stdoutBuffer);
      if (stderrBuffer.trim()) publishLine(stderrBuffer);
      
      if (options.streaming) {
        const doneMessage = JSON.stringify({
          type: "build_done",
          agent: options.streaming.agentLabel,
          exit_code: exitCode,
          timed_out: timedOut
        });
        options.streaming.publisher.publish(options.streaming.channel, doneMessage).catch(() => {});
      }
      
      const joined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
      const maxLength = 30_000;
      const output = joined.length > maxLength ? joined.slice(-maxLength) : joined;
      
      resolve({
        exitCode,
        timedOut,
        output
      });
    });
  });
}

export async function cleanupStaleContainers(prefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["ps", "-a", "-q", "--filter", `name=${prefix}`], {
      stdio: ["ignore", "pipe", "ignore"]
    });

    let output = "";
    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        resolve();
        return;
      }

      const containerIds = output.trim().split("\n").filter(Boolean);
      if (containerIds.length === 0) {
        resolve();
        return;
      }

      for (const id of containerIds) {
        await new Promise<void>((res) => {
          const rm = spawn("docker", ["rm", "-f", id], { stdio: "ignore" });
          rm.on("close", () => res());
        });
      }
      resolve();
    });

    child.on("error", () => resolve());
  });
}
