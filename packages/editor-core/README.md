# Editor-core 项目代码解析

## di

### setter.ts

- 文件主要是申明了 registerSetter 方法（在 shell/src/setter.ts 文件中进行绑定调用），在这里注册 setter，注册时会递归遍历，把注册的 setter 保存到 setterMap 中，通过 getSetter 方法进行查找。
