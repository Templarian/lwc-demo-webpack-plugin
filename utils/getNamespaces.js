const path = require('path');

function getNamespaceRoot(component) {
  var s = path.sep;
  var c = component.moduleName;
  return component.entry.replace(`${s}${c}${s}${c}.js`, '');
}

function getComponentRoot(component) {
  var s = path.sep;
  var c = component.moduleName;
  return component.entry.replace(`${s}${c}.js`, '');
}

module.exports = function (npmmodules) {
  const ignoreFolder = /(__examples__)/;
  const namespaces = [];

  return Object.values(npmmodules).filter(o => {
    return o.moduleNamespace && !o.moduleNamespace.match(ignoreFolder)
  }).reduce((namespaces, component) => {
    // Loop Components
    var namespace = namespaces.find(n => n.name === component.moduleNamespace);
    if (!namespace) {
      namespaces.push({
        name: component.moduleNamespace,
        folder: getNamespaceRoot(component),
        components: []
      });
      namespace = namespaces.find(n => n.name === component.moduleNamespace);
    }
    var comp = namespace.components.find(c => c.name === component.moduleName);
    if (!comp) {
      namespace.components.push({
        name: component.moduleName,
        namespace: component.moduleNamespace,
        folder: getComponentRoot(component)
      });
      comp = namespace.components.find(c => c.name === component.moduleName);
    }
    return namespaces;
  }, []);
};