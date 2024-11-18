import { Project, ts, type FileSystemHost } from "ts-morph"
import { globSync } from "glob"
import path, { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

function trimComments(comment: string) {
    if (!comment.startsWith("///")) throw new Error('Unable to trim comments that does not start with ///')
    return comment.replace("///", "").trim()
}

export default class YangonTransformer {
    project: Project
    fs: FileSystemHost
    constructor(compiler: ts.CompilerOptions) {
        const options = {
            ...compiler,
            strictNullChecks: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true
        }
        if(!options.outDir) options.outDir = "./.yangon"
        this.project = new Project({
            compilerOptions: options,
            useInMemoryFileSystem: true,
            skipAddingFilesFromTsConfig: true
        })

        this.fs = this.project.getFileSystem()
    }

    compile() {
        this.project.emitSync()
        this.fs.readDirSync("/")
    }

    getAllFile(path: string) {
        const allFilePaths: string[] = []

        const getFiles = (p: string) => {
            const dir = this.fs.readDirSync(p)

            for (const file of dir) {
                if(file.isDirectory) {
                    getFiles(file.name)
                } else {
                    allFilePaths.push(file.name)
                }
            }
        }

        getFiles(path)
    
        return allFilePaths
    }

    saveOutFiles() {
        const options = this.project.getCompilerOptions()
        const outDir = options.outDir!
        const files = this.getAllFile(outDir.replace(process.cwd(), ""))
        for (const file of files) {
            const content = this.fs.readFileSync(file)
            const dirPathArr = file.split("/")
            dirPathArr.pop()
            const dirPath = dirPathArr.join("/")
            if(!existsSync(process.cwd() + dirPath)) mkdirSync(process.cwd() + dirPath, { recursive: true })
            console.log("writing to " + path.join(process.cwd(), file))
            writeFileSync(path.join(process.cwd(), file), content)
        }
    }

    addDirWithGlob(glob: string) {
        const files = globSync(glob)
        const paths = files.map(v => path.join(process.cwd(), v))
        for (let i = 0; i < paths.length; i++) {
            const content = readFileSync(paths[i], "utf-8")
            this.createFile(files[i], content)
        }
    }

    createFolder(folderPath: string) {
        this.fs.mkdirSync(folderPath)
    }

    createFile(name: string, input: string) {
        const src = this.project.createSourceFile(name, input)
        const imports = src.getImportDeclarations().filter((i) => i.getModuleSpecifier().getText().replace(/("|')/g, "") === "@yangon-framework/shwedagon")
        for (const mod of imports) {
            mod.getModuleSpecifier().replaceWithText("\"@yangon-framework/core\"")
        }

        // decorators
        const classDeclar = src.getClasses()

        for (const classDecl of classDeclar) {
            const children = classDecl.getChildrenOfKind(ts.SyntaxKind.MethodDeclaration)
            for (const method of children) {
                // Modify the arguments of `Command`
                const commandDecorator = method.getDecorator("Command")
                if (!commandDecorator) continue
                const comments = commandDecorator.getLeadingCommentRanges()
                if (comments.length === 0) throw new Error("No commend description found")
                if (comments.length > 1) console.warn("There are more than one comments to this command. Only counting the 1st one.")
                const comment = comments[0].getText()

                commandDecorator.insertArgument(0, `"${trimComments(comment)}"`)

                const params = method.getParameters()
                params.shift() // this is the ctx param

                for (const param of params) {
                    const deco = param.getDecorator("Option")
                    if (!deco) continue;

                    const descriptions = deco.getLeadingCommentRanges()
                    if (descriptions.length > 1) console.warn("There are more than one comments to this command. Only counting the 1st one.")

                    const desc = descriptions[0].getText()
                    deco.insertArgument(0, `"${trimComments(desc)}"`)

                    const optional = param.getType()
                    deco.insertArgument(1, `${!(optional.getText() === "any")}`)
                }
            }
        }

        src.saveSync()
    }
}