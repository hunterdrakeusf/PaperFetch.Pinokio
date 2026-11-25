module.exports = {
  run: [
    {
      method: "fs.rm",
      params: {
        path: "app"
      }
    },
    {
      method: "fs.rm",
      params: {
        path: "conda_env"
      }
    },
    {
      method: "fs.rm",
      params: {
        path: "tools"
      }
    }
  ]
}
