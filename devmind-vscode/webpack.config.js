const path = require('path');

module.exports = {
  mode: 'none', // Leave as none for now, can be overridden by scripts
  target: 'node', // extensions run in a node context
  entry: {
    extension: './src/extension.ts' // entry point
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs' // VS Code expects commonjs
  },
  resolve: {
    extensions: ['.ts', '.js'] // resolve these extensions
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  externals: {
    vscode: 'commonjs vscode' // the vscode module is provided by VS Code
  }
};
