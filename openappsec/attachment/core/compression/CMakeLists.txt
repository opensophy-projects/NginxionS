add_definitions(-DZLIB_CONST)

add_library(osrc_compression_utils SHARED compression_utils.cc)

# NginxionS: compression_utils.cc calls zlib-ng (zng_inflate, zng_deflate...), the library is linked to it now.
# Without it these symbols were found only when the process had loaded zlib-ng already (an nginx built with zlib-ng);
# with another nginx, dlopen of the module failed: "libosrc_compression_utils.so: undefined symbol"
# (openappsec/attachment, "dlopen() modules/libngx_module.so failed ... undefined symbol: inflate").
pkg_check_modules(ZLIBNG REQUIRED IMPORTED_TARGET zlib-ng)

target_link_libraries(osrc_compression_utils
    ${Brotli_LIBRARIES}
    PkgConfig::ZLIBNG
)

install(TARGETS osrc_compression_utils DESTINATION lib)
install(TARGETS osrc_compression_utils DESTINATION nginx_attachment/lib)
