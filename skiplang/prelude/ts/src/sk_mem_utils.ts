import type { int, FileSystem, System } from "./sk_types.js";
import { Options } from "./sk_types.js";

class File {
  contents?: string;
  changes?: string;
  options?: Options;
  cursor: int;
  onChange?: (contents: string) => void;
  withChange: boolean;

  constructor(options?: Options) {
    this.options = options;
    this.cursor = 0;
    this.withChange = false;
  }

  open(options: Options) {
    this.options = options;
    this.cursor = 0;
    this.withChange = false;
    this.changes = "";
  }

  watch(onChange: (change: string) => void) {
    this.onChange = onChange;
  }

  close() {
    if (this.withChange && this.onChange) {
      this.onChange!(this.changes ?? "");
    }
    this.options = undefined;
    this.changes = "";
  }

  write(contents: string, append: boolean = false) {
    if (!this.options || !this.options.write) {
      throw new Error("The file cannot be written");
    }
    if ((this.contents && this.options.append) || append) {
      this.contents += contents;
    } else {
      this.contents = contents;
    }
    let old = this.changes;
    this.changes += contents;
    this.withChange = this.changes != old;
    return contents.length;
  }

  read(len: int) {
    if (!this.options || !this.options.read) {
      throw new Error("The file cannot be read");
    }
    let clen = this.contents ? this.contents.length : 0;
    if (this.cursor >= clen) {
      return null;
    }
    let end = Math.min(clen, this.cursor + len);
    let res = this.contents?.substring(this.cursor, end);
    this.cursor = end;
    return res;
  }

  isOpen() {
    return this.options != undefined;
  }
}

export class MemFS implements FileSystem {
  private fileDescrs: Map<string, number>;
  private fileDescrNbr: int;
  private files: Array<File>;
  // invariant: range(fileDescrs) ⊆ domain(files)

  constructor() {
    this.fileDescrs = new Map();
    this.fileDescrNbr = 2;
    this.files = new Array();
  }

  exists(filename: string): boolean {
    return this.fileDescrs.has(filename);
  }

  openFile(filename: string, options: Options, _mode: int): number {
    let existing = this.fileDescrs.get(filename);
    if (existing != undefined) {
      if (options.create && options.create_new) {
        throw new Error("The file '" + filename + "' already exists");
      }
      this.files[existing]!.open(options); // invariant
      return existing;
    }
    let fd = this.fileDescrNbr;
    this.files[fd] = new File(options);
    this.fileDescrs.set(filename, fd);
    this.fileDescrNbr++;
    return fd;
  }

  watchFile(filename: string, f: (change: string) => void): void {
    let fd = this.fileDescrNbr;
    this.files[fd] = new File();
    this.fileDescrs.set(filename, fd);
    this.fileDescrNbr++;
    this.files[fd].watch(f);
  }

  writeToFile(fd: int, content: string) {
    let file = this.files[fd];
    if (file == undefined) {
      throw new Error("Invalid file descriptor " + fd);
    }
    file.write(content);
  }

  appendToFile(filename: string, content: string) {
    let fd = this.fileDescrs.get(filename);
    let file: File;
    if (fd != undefined) {
      file = this.files[fd]!; // invariant
    } else {
      file = new File();
      let fd = this.fileDescrNbr;
      this.files[fd] = file;
      this.fileDescrs.set(filename, fd);
      this.fileDescrNbr++;
    }
    file.open(new Options(false, true, true));
    file.write(content);
    file.close();
  }

  closeFile(fd: int) {
    let file = this.files[fd];
    if (file == undefined) {
      throw new Error("Invalid file descriptor " + fd);
    }
    file.close();
  }

  write(fd: int, content: string) {
    let file = this.files[fd];
    if (file == undefined) {
      throw new Error("Invalide file descriptor " + fd);
    }
    return file.write(content);
  }

  read(fd: int, len: int): string | null {
    let file = this.files[fd];
    if (file == undefined) {
      throw new Error("Invalide file descriptor " + fd);
    }
    return file.read(len) ?? null;
  }
}

export class MemSys implements System {
  private env: Map<string, string>;

  constructor() {
    this.env = new Map();
  }

  setenv(name: string, value: string) {
    this.env.set(name, value);
  }

  getenv(name: string) {
    return this.env.get(name) ?? null;
  }

  unsetenv(name: string): void {
    this.env.delete(name);
  }
}
