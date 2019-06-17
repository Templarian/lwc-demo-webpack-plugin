const glob = require('glob');
const fs = require('fs');
const path = require('path');
const jsdoc = require('jsdoc-api');
const VirtualModulesPlugin = require('webpack-virtual-modules');
const getNamespaces = require('./utils/getNamespaces');
const getFilesToWatch = require('./utils/getFilesToWatch');
const {
  LAYOUT,
  getConfig,
  getInfoFromPath,
  isValidModuleName,
  getInfoFromId,
  npmmodules
} = require('./utils/module');

/*
General note about this file... it is very ugly.
With that said it generates demo app documented
in the README.md
*/

const normalizeDescription = function (comment) {
  if (!comment) { return null; }
  return comment.split(/\r?\n/g)
    .map(s => {
      var m = s.match(/\* ?(.*)/)[1];
      if (m.match(/^(\*|\/|@)/)) {
        return '';
      }
      return m;
    })
    .filter(s => s !== '')
    .join("\n")
}

const normalizeJSdoc = function (jsdoc) {
  // JSdoc output is very nested
  if (jsdoc.length === 0) {
    return null
  }
  const items = [];
  jsdoc.forEach(item => {
    if (item.kind !== "member") {
      return;
    }
    const props = {
      name: item.name || null,
      description: normalizeDescription(item.comment),
      kind: item.meta.code.type || "Class",
      types: item.type ? item.type.names : [],
      defaultValue: item.defaultvalue || null
    };
    if (item.tags) {
      item.tags.forEach(tag => {
        props[tag.title] = tag.value;
      });
    }
    items.push(props);
  });
  return items;
}

const virtualModules = new VirtualModulesPlugin({
  'node_modules/data.js': `const data = {};export default data;`
});

class LwcDemoWebpackPlugin {
  constructor(options) {
    var defaultOptions = {
      excludes: ['demo'],
      modules: []
    }
    this.options = { ...defaultOptions, ...(options || {}) };
    // Array of namespaces and components to watch
    this.namespaces = getNamespaces(npmmodules);
  }

  apply(compiler) {
    // Plugin Name
    var plugin = 'GenerateDemoJson';
    // Apply Virtual Modules
    virtualModules.apply(compiler);
    // Console Log Watchers
    this.namespaces.forEach(namespace => {
      console.log(`Namespace: ${namespace.name}`);
      namespace.components.forEach(component => {
        console.log(` - Component: ${component.name}`);
      });
    });

    compiler.hooks.compilation.tap(plugin, compilation => {
      // Watch Files
      compilation.fileDependencies = [];
      this.namespaces.forEach(namespace => {
        namespace.components.forEach(component => {
          var files = getFilesToWatch(component.folder);
          files.forEach(file => {
            compilation.fileDependencies.push(file);
          })
        });
      });
      
      // This is the actual data imported
      var data = JSON.stringify(demoJson);
      virtualModules.writeModule(
        'node_modules/data.js',
        `const data = ${data};export default data;`
      );
    });

    var demoJson = {
      namespaces: [],
      excludes: this.options.excludes || ['demo'],
      includes: this.options.includes || [],
      modules: this.options.modules || []
    };

    var toRelative = function (absolute, root) {
      return absolute.replace(root, '').replace(/\\/g, '/').replace(/^\//, '');
    };

    compiler.hooks.emit.tapAsync('emit', function (compilation, callback) {
      var data = JSON.stringify(demoJson);
      // This is just for reference
      compilation.assets['demo.json'] = {
        source: function () {
          return data;
        },
        size: function () {
          return data.length;
        }
      };
      callback();
    });

    function isLightningElement(statement) {
      return statement.superClass
        && statement.superClass.name === 'LightningElement';
    }

    compiler.hooks.normalModuleFactory.tap(plugin, factory => {
      factory.hooks.parser.for('javascript/auto').tap(plugin, (parser, options) => {
        parser.hooks.statement.tap(plugin, statement => {
          switch (statement.type) {
            case 'ClassDeclaration':
              if (isLightningElement(statement)) {
                var root = parser.state.options.context;
                var resource = parser.state.module.resource;
                var fileRelative = toRelative(resource, root);
                var name = statement.id.name;
                var directory = path.dirname(resource);
                var parts = directory.split(path.sep);
                var eleName = parts.pop();
                var namespaceRelative = toRelative(parts.join(path.sep), root);
                var eleNamespace = parts.pop();
                var hasExamplesFolder = false;
                var examples = [];
                var examplesFolder = path.join(directory, '__examples__');
                // List files in directory
                var files = [];
                fs.readdir(directory, function (err, items) {
                  if (!items) { return; } // Virtual Directory
                  items.forEach(item => {
                    var stat = fs.statSync(path.join(directory, item));
                    if (stat.isFile()) {
                      files.push({
                        name: item,
                        file: toRelative(path.join(directory, item), root)
                      });
                    }
                  });
                });
                if (fs.existsSync(examplesFolder)) {
                  // This just lets us know the folder exists
                  hasExamplesFolder = true;
                  // Now we look for valid examples
                  fs.readdir(examplesFolder, function (err, items) {
                    items.forEach(item => {
                      var stat = fs.statSync(path.join(examplesFolder, item));
                      if (stat.isDirectory()) {
                        examples.push({
                          name: item,
                          folder: toRelative(path.join(examplesFolder, item), root),
                          files: [],
                          errors: [],
                          warnings: [],
                        });
                        var example = examples.find(e => e.name == item);
                        // Verify JS exists, __examples__/basic/basic.js
                        if (!(fs.existsSync(path.join(examplesFolder, item, `${item}.js`)))) {
                          example.errors.push({
                            code: 1,
                            message: `Example "${item}" is missing "${item}.js"`
                          });
                        }
                        // Verify HTML exists, __examples__/basic/basic.js
                        if (!(fs.existsSync(path.join(examplesFolder, item, `${item}.html`)))) {
                          example.errors.push({
                            code: 2,
                            message: `Example "${item}" is missing "${item}.html"`
                          });
                        }
                        // List example files
                        // TODO: Recursive
                        var exampleFolder = path.join(examplesFolder, item);
                        fs.readdir(exampleFolder, function (err, eItems) {
                          eItems.forEach(eItem => {
                            var eFile = path.join(exampleFolder, eItem);
                            var eStat = fs.statSync(eFile);
                            if (eStat.isFile()) {
                              example.files.push({
                                name: eItem,
                                file: toRelative(eFile, root),
                                source: fs.readFileSync(eFile, 'utf8')
                              });
                            }
                          });
                        });
                      }
                    });
                  });
                }
                // Skip if in options.excludes. Ex: ['demo']
                if (this.options.excludes.includes(eleNamespace)) {
                  break;
                }
                var namespace = demoJson.namespaces.find(n => n.name === eleNamespace);
                if (!namespace) {
                  demoJson.namespaces.push({
                    name: eleNamespace,
                    folder: namespaceRelative,
                    components: []
                  });
                  namespace = demoJson.namespaces.find(n => n.name === eleNamespace);
                }
                var component = namespace.components.find(c => c.name == eleName);
                if (!component) {
                  namespace.components.push({
                    name: eleName
                  });
                  component = namespace.components.find(c => c.name == eleName);
                }
                var jsdocObj = jsdoc.explainSync({
                  files: resource
                });
                var jsdocNorm = normalizeJSdoc(jsdocObj);
                var cls = jsdocNorm.find(x => x.kind == 'Class');
                component.order = cls ? cls.order : 1;
                component.file = fileRelative;
                component.files = files;
                component.name = eleName;
                component.namespace = eleNamespace;
                component.tag = `${eleNamespace}-${eleName}`
                component.hasExamplesFolder = hasExamplesFolder;
                component.examplesFolder = toRelative(examplesFolder, root);
                component.examples = examples;
                component.jsdoc = jsdocNorm;
                component.doc = 'testing';
                //fs.readFileSync(path.join(directory, `${item}.md`), 'utf8');
              }
              break;
          }
        });
      });
    });

    compiler.hooks.afterPlugins.tap(plugin, () => {
      virtualModules.writeModule(
        'src/modules/demo/fake/fake.js',
        "import { LightningElement } from 'lwc';export default class Fake extends LightningElement {}"
      );
      virtualModules.writeModule(
        'src/modules/demo/fake/fake.html',
        '<template>Testing</template>'
      );
      fs.readdir(path.join("src", "modules"), function (err, items) {
        items.forEach(item => {
          var folder = path.join("src", "modules", item);
          var stat = fs.statSync(folder);
          if (stat.isDirectory()) {
            if (item === 'mdi'){
              /*var files = walkSync(folder)
                .map(f => f.replace(/\\/g, '/'))
                .forEach(f => {
                  virtualModules.writeModule(
                    f,
                    fs.readFileSync(f, 'utf8')
                  );
                });*/
            }
          }
        });
      });
    });
  }
}

module.exports = LwcDemoWebpackPlugin;
